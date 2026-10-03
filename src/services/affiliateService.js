/*
 * AFILIADOS / PROMOTORES — reglas de negocio compartidas (registro público,
 * alta administrativa, panel del promotor y módulo admin).
 *
 * La relación es ÚNICAMENTE DIRECTA: ClientProfile.referredByClientId es el
 * afiliador directo y se fija una sola vez al crear la cuenta. Nunca se
 * recorre la cadena de afiliadores: una comisión por un cliente solo puede
 * corresponder a SU afiliador directo (no hay niveles ni comisiones heredadas).
 */
const crypto = require('crypto');
const { isAccountActivated, ACTIVATION_SELECT } = require('../utils/accountActivation');
const QRCode = require('qrcode');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { isOriginAllowed, normalizeOrigin } = require('../config/corsConfig');
const { decrypt } = require('../utils/crypto');

const CODE_PATTERN = /^[A-Z0-9]{3,32}$/;
// Mismo mensaje para "no existe", "desactivado" y "programa inactivo": no
// revela cuál de los casos aplica (evita enumerar códigos/estados).
const INVALID_CODE_MESSAGE = 'El código de afiliado no existe, está desactivado o ya no puede utilizarse.';

// Normaliza lo que escribe/pega el visitante: sin espacios ni guiones y en
// mayúsculas (los códigos se guardan así, de modo que "danielqlc" y
// "DANIELQLC" son el mismo código).
function normalizeAffiliateCode(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

// Referencia inicial del documento QLC Affiliate Program: 50% cliente, 40%
// QLC, 10% afiliador directo, sobre la RENTABILIDAD GENERADA.
const DEFAULT_CONFIG = {
  id: null,
  enabled: true,
  commissionType: 'PERCENTAGE',
  commissionValue: null,
  clientSharePct: 50,
  qlcSharePct: 40,
  affiliateSharePct: 10,
  balanceStaleDays: 31,
  updatedAt: null,
};

async function getAffiliateConfig(db = prisma) {
  const config = await db.affiliateConfiguration.findFirst({ orderBy: { createdAt: 'asc' } });
  return config || DEFAULT_CONFIG;
}

// CONFIGURACIÓN VIGENTE en una fecha: la versión más reciente cuya fecha de
// vigencia ya llegó (AffiliateConfigurationHistory). Una versión con vigencia
// futura queda programada y no se aplica antes de tiempo. Sin versiones, la
// configuración base. Devuelve también el ID de la versión usada (trazabilidad
// de cada cálculo).
async function getEffectiveConfig(at = new Date(), db = prisma) {
  const [base, version] = await Promise.all([
    getAffiliateConfig(db),
    db.affiliateConfigurationHistory.findFirst({ where: { effectiveFrom: { lte: at } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  if (!version) return { ...base, versionId: null, effectiveFrom: null };
  return {
    ...base,
    clientSharePct: version.clientSharePct,
    qlcSharePct: version.qlcSharePct,
    affiliateSharePct: version.affiliateSharePct,
    balanceStaleDays: version.balanceStaleDays ?? base.balanceStaleDays,
    versionId: version.id,
    effectiveFrom: version.effectiveFrom,
  };
}

// ¿El dato registrado sigue vigente? Si no existe o supera la antigüedad
// configurada se muestra "Sin actualizar" (nunca un dato viejo como actual).
function isRecordFresh(date, staleDays, now = new Date()) {
  if (!date) return false;
  return now.getTime() - new Date(date).getTime() <= Number(staleDays) * 24 * 60 * 60 * 1000;
}

// Afiliador ACTIVO a partir de un código (validación del backend: el
// visitante solo envía el código; el ID real lo resuelve siempre el backend).
async function resolveActiveReferrer(db, rawCode) {
  const code = normalizeAffiliateCode(rawCode);
  if (!CODE_PATTERN.test(code)) throw ApiError.badRequest(INVALID_CODE_MESSAGE);
  const config = await getAffiliateConfig(db);
  if (!config.enabled) throw ApiError.badRequest(INVALID_CODE_MESSAGE);
  const referrer = await db.clientProfile.findUnique({
    where: { affiliateCode: code },
    select: { id: true, firstName: true, affiliateCode: true, affiliateEnabled: true, status: true, user: { select: { isActive: true } } },
  });
  if (!referrer || !referrer.affiliateEnabled || referrer.status === 'INACTIVE' || !referrer.user?.isActive) {
    throw ApiError.badRequest(INVALID_CODE_MESSAGE);
  }
  return referrer;
}

// CÓDIGO DE AFILIACIÓN — aleatorio criptográfico (crypto.randomInt), de 12
// caracteres de un alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L). No se
// deriva del nombre ni contiene palabras: no es adivinable ni enumerable
// (31^12 ≈ 7.9·10^17 combinaciones). Siempre mezcla letras y números.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

function generateAffiliateCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    const digits = (code.match(/[2-9]/g) || []).length;
    if (digits >= 3 && digits <= CODE_LENGTH - 3) return code;
  }
}

// Intenta guardar un código nuevo hasta que la BD lo acepte: la unicidad la
// garantiza el índice único (una colisión, aunque improbable, recibe P2002 y
// se genera otro). `where` condiciona el UPDATE (nunca pisa uno existente
// salvo en una regeneración autorizada).
async function assignNewCode(where) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateAffiliateCode();
    try {
      const { count } = await prisma.clientProfile.updateMany({ where, data: { affiliateCode: candidate } });
      return { code: candidate, count };
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }
  }
  throw ApiError.serviceUnavailable('No se pudo generar un código de afiliado único. Intenta nuevamente.');
}

// Asigna el código único del cliente si todavía no tiene uno (nunca
// sobrescribe uno existente: el UPDATE está condicionado a affiliateCode
// NULL, también ante dos solicitudes simultáneas).
async function ensureAffiliateCode(clientId) {
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId }, select: { affiliateCode: true } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (client.affiliateCode) return { code: client.affiliateCode, generated: false };
  const { count } = await assignNewCode({ id: clientId, affiliateCode: null });
  const current = await prisma.clientProfile.findUnique({ where: { id: clientId }, select: { affiliateCode: true } });
  return { code: current.affiliateCode, generated: count === 1 };
}

// REGENERAR (solo ADMIN): únicamente si el código todavía no tiene NINGÚN
// referido — así nunca se rompe una relación histórica ni una liga que ya
// atribuyó clientes.
async function regenerateAffiliateCode(clientId) {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { affiliateCode: true, _count: { select: { referrals: true } } },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (client._count.referrals > 0) {
    throw ApiError.conflict('Este código ya tiene referidos: no se puede regenerar sin romper la atribución histórica.');
  }
  const previous = client.affiliateCode;
  const { code, count } = await assignNewCode({ id: clientId, affiliateCode: previous, referrals: { none: {} } });
  if (!count) throw ApiError.conflict('El código cambió mientras se regeneraba. Intenta nuevamente.');
  return { previous, code };
}

// Estado general del referido, a partir de estados REALES del sistema:
// ACTIVO = al menos una subcuenta activa con su proceso de activación
// completado; INACTIVO = cliente/usuario desactivado; EN_PROCESO = el resto.
function referralStatus(client) {
  if (client.status === 'INACTIVE' || client.user?.isActive === false) return 'INACTIVO';
  const activated = (client.apiSubaccounts || []).some(isAccountActivated);
  return activated ? 'ACTIVO' : 'EN_PROCESO';
}

// Select mínimo para calcular el estado del referido (nada de API, pagos,
// documentos ni saldos).
const REFERRAL_STATUS_SELECT = {
  status: true,
  user: { select: { isActive: true } },
  apiSubaccounts: { select: ACTIVATION_SELECT },
};

// Lo que el AFILIADOR puede ver como identificación de su referido: SOLO
// iniciales (nunca nombre completo, correo ni teléfono).
function promoterVisibleName(client) {
  return initialsOf(client);
}

// Origen del frontend para construir el enlace: el origen real desde el que
// se usa el panel (validado contra la lista blanca de CORS); si no viene o no
// está permitido, CLIENT_ORIGIN. Nunca un dominio fijo en código.
function resolveFrontendOrigin(requestedOrigin) {
  if (requestedOrigin && isOriginAllowed(requestedOrigin)) return normalizeOrigin(requestedOrigin);
  return normalizeOrigin(process.env.CLIENT_ORIGIN || '');
}

function buildAffiliateLink(origin, code) {
  return `${origin}/registro?ref=${encodeURIComponent(code)}`;
}

function buildAffiliateQr(link) {
  return QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
}

// Suma de comisiones por estado (Decimal → number con 2 decimales).
function commissionTotals(groups) {
  const totals = { PENDIENTE: 0, APROBADA: 0, PAGADA: 0, CANCELADA: 0 };
  for (const g of groups) totals[g.status] = Number(g._sum.amount || 0);
  return totals;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// DISTRIBUCIÓN de la rentabilidad generada del periodo (resultAmount que QLC
// registra/valida en el estado de cuenta — nunca un PnL consultado a Bitget).
// Sin rentabilidad positiva no hay nada que repartir. Los tres componentes
// del documento (cliente / QLC / QLC Affiliate Program) se calculan SIEMPRE;
// solo se genera comisión a pagar cuando el cliente tiene afiliador directo.
function computeDistribution(resultAmount, config) {
  const clientSharePct = Number(config.clientSharePct);
  const qlcSharePct = Number(config.qlcSharePct);
  const affiliateSharePct = Number(config.affiliateSharePct);
  const profit = Number(resultAmount) > 0 ? round2(resultAmount) : 0;
  const clientResultAmount = round2((profit * clientSharePct) / 100);
  const affiliateCommissionAmount = round2((profit * affiliateSharePct) / 100);
  const qlcCommissionAmount = round2(profit - clientResultAmount - affiliateCommissionAmount);
  return { clientSharePct, qlcSharePct, affiliateSharePct, clientResultAmount, qlcCommissionAmount, affiliateCommissionAmount };
}

// Solo INICIALES del referido para el afiliador ("Carlos Méndez" → "C.M.").
function initialsOf(client) {
  const pick = (v) => String(v || '').trim().charAt(0).toUpperCase();
  return [pick(client.firstName), pick(client.lastName)].filter(Boolean).map((c) => `${c}.`).join('');
}

// Terminación de la API Key como REFERENCIA VISUAL ("••••7F2A"). Se descifra
// solo en el backend; al navegador nunca llega la clave completa ni el Secret.
function apiKeyTail(apiKeyEncrypted) {
  if (!apiKeyEncrypted) return null;
  try {
    const key = String(decrypt(apiKeyEncrypted) || '');
    return key ? `••••${key.slice(-4)}` : null;
  } catch {
    return null;
  }
}

// Bitácora del programa (best effort: nunca bloquea la operación principal).
async function logAffiliateEvent(db, { action, clientId = null, actorUserId = null, details = null }) {
  try {
    await (db || prisma).affiliateAuditLog.create({ data: { action, clientId, actorUserId, details } });
  } catch (err) {
    console.error('[affiliates] No se pudo registrar el evento de auditoría:', err.message);
  }
}

module.exports = {
  INVALID_CODE_MESSAGE,
  CODE_PATTERN,
  normalizeAffiliateCode,
  getAffiliateConfig,
  resolveActiveReferrer,
  ensureAffiliateCode,
  regenerateAffiliateCode,
  generateAffiliateCode,
  referralStatus,
  REFERRAL_STATUS_SELECT,
  promoterVisibleName,
  resolveFrontendOrigin,
  buildAffiliateLink,
  buildAffiliateQr,
  commissionTotals,
  logAffiliateEvent,
  computeDistribution,
  getEffectiveConfig,
  isRecordFresh,
  initialsOf,
  apiKeyTail,
  round2,
};
