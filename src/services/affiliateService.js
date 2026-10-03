/*
 * AFILIADOS / PROMOTORES — reglas de negocio compartidas (registro público,
 * alta administrativa, panel del promotor y módulo admin).
 *
 * La relación es ÚNICAMENTE DIRECTA: ClientProfile.referredByClientId es el
 * afiliador directo y se fija una sola vez al crear la cuenta. Nunca se
 * recorre la cadena de afiliadores: una comisión por un cliente solo puede
 * corresponder a SU afiliador directo (no hay niveles ni comisiones heredadas).
 */
const QRCode = require('qrcode');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { isOriginAllowed, normalizeOrigin } = require('../config/corsConfig');

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

const DEFAULT_CONFIG = { id: null, enabled: true, commissionType: 'PERCENTAGE', commissionValue: null, updatedAt: null };

async function getAffiliateConfig(db = prisma) {
  const config = await db.affiliateConfiguration.findFirst({ orderBy: { createdAt: 'asc' } });
  return config || DEFAULT_CONFIG;
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

// Base legible a partir del nombre ("Daniel" → "DANIELQLC"). Solo A-Z.
function baseCodeFor(firstName) {
  const letters = String(firstName || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 12);
  return `${letters.length >= 2 ? letters : 'CLIENTE'}QLC`;
}

function randomSuffix() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Asigna el código único del cliente si todavía no tiene uno (nunca
// sobrescribe uno existente: el UPDATE está condicionado a affiliateCode
// NULL). La unicidad la garantiza el índice único de la BD: si dos
// generaciones concurrentes eligen el mismo candidato, la segunda recibe
// P2002 y prueba el siguiente.
async function ensureAffiliateCode(clientId) {
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId }, select: { firstName: true, affiliateCode: true } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (client.affiliateCode) return { code: client.affiliateCode, generated: false };
  const base = baseCodeFor(client.firstName);
  const candidates = [base];
  for (let n = 2; n <= 30; n += 1) candidates.push(`${base}${n}`);
  for (let i = 0; i < 10; i += 1) candidates.push(`${base}${randomSuffix()}`);
  for (const candidate of candidates) {
    try {
      const { count } = await prisma.clientProfile.updateMany({ where: { id: clientId, affiliateCode: null }, data: { affiliateCode: candidate } });
      const current = await prisma.clientProfile.findUnique({ where: { id: clientId }, select: { affiliateCode: true } });
      return { code: current.affiliateCode, generated: count === 1 };
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }
  }
  throw ApiError.serviceUnavailable('No se pudo generar un código de afiliado único. Intenta nuevamente.');
}

// Estado general del referido, a partir de estados REALES del sistema:
// ACTIVO = al menos una subcuenta activa con su proceso de activación
// completado; INACTIVO = cliente/usuario desactivado; EN_PROCESO = el resto.
function referralStatus(client) {
  if (client.status === 'INACTIVE' || client.user?.isActive === false) return 'INACTIVO';
  const activated = (client.apiSubaccounts || []).some((s) => !s.deactivatedAt && s.process?.isActivated);
  return activated ? 'ACTIVO' : 'EN_PROCESO';
}

// Select mínimo para calcular el estado del referido (nada de API, pagos,
// documentos ni saldos).
const REFERRAL_STATUS_SELECT = {
  status: true,
  user: { select: { isActive: true } },
  apiSubaccounts: { select: { deactivatedAt: true, process: { select: { isActivated: true } } } },
};

// Nombre que el PROMOTOR puede ver de su referido: nombre + inicial.
function promoterVisibleName(client) {
  const initial = client.lastName ? ` ${client.lastName.trim().charAt(0).toUpperCase()}.` : '';
  return `${client.firstName}${initial}`;
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
  referralStatus,
  REFERRAL_STATUS_SELECT,
  promoterVisibleName,
  resolveFrontendOrigin,
  buildAffiliateLink,
  buildAffiliateQr,
  commissionTotals,
  logAffiliateEvent,
};
