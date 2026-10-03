const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const driveStorage = require('../services/driveStorageService');
const { notifyClient } = require('../utils/notify');
const { EVIDENCE_MIME } = require('../middleware/upload');
const { matchesSignature } = require('../utils/fileSignature');
const { safeFileName } = require('../utils/supportCaseFiles');
const {
  normalizeAffiliateCode,
  getAffiliateConfig,
  getEffectiveConfig,
  resolveActiveReferrer,
  ensureAffiliateCode,
  regenerateAffiliateCode,
  referralStatus,
  REFERRAL_STATUS_SELECT,
  resolveFrontendOrigin,
  buildAffiliateLink,
  commissionTotals,
  logAffiliateEvent,
  round2,
} = require('../services/affiliateService');

/*
 * AFFILIATE MANAGEMENT (admin) — QLC Affiliate Program.
 * Relación únicamente DIRECTA. Comisiones calculadas sobre la rentabilidad
 * que QLC registra/valida en sus estados de cuenta (nunca datos de Bitget).
 * Calcular una comisión no es pagarla: el pago es un registro separado.
 */

// ==========================================================
// PÚBLICO — validar una invitación antes de mostrar el registro
// ==========================================================
// Solo confirma que el código es válido: no expone ningún dato del afiliador.
const validateAffiliateCode = asyncHandler(async (req, res) => {
  const referrer = await resolveActiveReferrer(prisma, req.query.code);
  res.json({ ok: true, valid: true, code: referrer.affiliateCode });
});

// Reparto PÚBLICO de la ganancia generada (cliente / QLC / promotor
// afiliador) vigente hoy — el mismo que se aplica en los estados de cuenta.
// Solo porcentajes; ningún dato privado.
const getPublicDistribution = asyncHandler(async (req, res) => {
  const c = await getEffectiveConfig(new Date());
  res.json({
    ok: true,
    distribution: {
      clientSharePct: Number(c.clientSharePct),
      qlcSharePct: Number(c.qlcSharePct),
      affiliateSharePct: Number(c.affiliateSharePct),
    },
  });
});

// ==========================================================
// ADMIN — configuración del programa (versionada)
// ==========================================================
const shapeConfig = (c) => ({
  enabled: c.enabled,
  clientSharePct: Number(c.clientSharePct),
  qlcSharePct: Number(c.qlcSharePct),
  affiliateSharePct: Number(c.affiliateSharePct),
  balanceStaleDays: c.balanceStaleDays != null ? Number(c.balanceStaleDays) : null,
  updatedAt: c.updatedAt,
});

// Editar porcentajes/base es exclusivo del ADMINISTRADOR GENERAL (mismo
// criterio de permisos que las acciones críticas existentes).
async function isGeneralAdmin(userId) {
  const profile = await prisma.adminProfile.findUnique({ where: { userId }, select: { isGeneralAdmin: true } });
  return Boolean(profile?.isGeneralAdmin);
}

const getConfig = asyncHandler(async (req, res) => {
  const now = new Date();
  const [effective, history, canEdit] = await Promise.all([
    getEffectiveConfig(now),
    prisma.affiliateConfigurationHistory.findMany({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 30 }),
    isGeneralAdmin(req.user.id),
  ]);
  res.json({
    ok: true,
    // Configuración VIGENTE hoy (versión aplicada a los cálculos).
    config: { ...shapeConfig(effective), versionId: effective.versionId, effectiveFrom: effective.effectiveFrom },
    canEdit,
    history: history.map((h) => ({
      id: h.id,
      ...shapeConfig(h),
      effectiveFrom: h.effectiveFrom,
      createdAt: h.createdAt,
      scheduled: h.effectiveFrom > now,
      current: h.id === effective.versionId,
    })),
  });
});

const pct = z.coerce.number().min(0, 'Porcentaje inválido.').max(100, 'Porcentaje inválido.');
const configSchema = z
  .object({
    enabled: z.boolean(),
    clientSharePct: pct,
    qlcSharePct: pct,
    affiliateSharePct: pct,
    balanceStaleDays: z.coerce.number().int().min(1, 'La antigüedad mínima es 1 día.').max(365, 'La antigüedad máxima es 365 días.'),
    // Fecha de vigencia de esta versión (hoy o futura; nunca retroactiva).
    effectiveFrom: z.coerce.date().optional(),
  })
  .refine((d) => Math.abs(d.clientSharePct + d.qlcSharePct + d.affiliateSharePct - 100) < 0.001, {
    message: 'La distribución debe sumar 100%.',
    path: ['affiliateSharePct'],
  });

// Cada cambio guarda una VERSIÓN con su fecha de vigencia — nunca se pierde
// la configuración previa. Los estados de cuenta ya emitidos conservan la
// versión con que se calcularon (affiliateConfigVersionId).
const updateConfig = asyncHandler(async (req, res) => {
  if (!(await isGeneralAdmin(req.user.id))) {
    throw ApiError.forbidden('Solo el administrador general puede modificar los porcentajes del QLC Affiliate Program.');
  }
  const { effectiveFrom: requested, ...data } = configSchema.parse(req.body);
  const now = new Date();
  const effectiveFrom = requested || now;
  if (effectiveFrom.getTime() < now.getTime() - 5 * 60 * 1000) {
    throw ApiError.badRequest('La fecha de vigencia no puede ser anterior a hoy (no se aplican cambios retroactivos).');
  }
  const previous = await getEffectiveConfig(now);
  const base = await getAffiliateConfig();
  const appliesNow = effectiveFrom.getTime() <= now.getTime();
  // "Programa activo" se aplica de inmediato; los porcentajes, desde su vigencia.
  const baseValues = appliesNow ? { ...data, updatedByUserId: req.user.id } : { enabled: data.enabled, updatedByUserId: req.user.id };
  const version = await prisma.$transaction(async (tx) => {
    if (base.id) await tx.affiliateConfiguration.update({ where: { id: base.id }, data: baseValues });
    else await tx.affiliateConfiguration.create({ data: { ...data, updatedByUserId: req.user.id } });
    return tx.affiliateConfigurationHistory.create({
      data: {
        enabled: data.enabled,
        clientSharePct: data.clientSharePct,
        qlcSharePct: data.qlcSharePct,
        affiliateSharePct: data.affiliateSharePct,
        balanceStaleDays: data.balanceStaleDays,
        effectiveFrom,
        updatedByUserId: req.user.id,
      },
    });
  });
  await logAffiliateEvent(prisma, {
    action: 'PROGRAM_CONFIG_UPDATED',
    actorUserId: req.user.id,
    details: { previous: { ...shapeConfig(previous), versionId: previous.versionId }, next: data, versionId: version.id, effectiveFrom },
  });
  const effective = await getEffectiveConfig(new Date());
  res.json({ ok: true, config: { ...shapeConfig(effective), versionId: effective.versionId, effectiveFrom: effective.effectiveFrom } });
});

// ==========================================================
// ADMIN — afiliadores
// ==========================================================
// Afiliador = cliente con código de afiliación o con referidos directos.
const PROMOTER_WHERE = { OR: [{ affiliateCode: { not: null } }, { referrals: { some: {} } }] };

const listAffiliates = asyncHandler(async (req, res) => {
  const { search, status } = req.query;
  const term = String(search || '').trim();
  const where = {
    AND: [
      PROMOTER_WHERE,
      status === 'ACTIVE' ? { affiliateEnabled: true } : status === 'INACTIVE' ? { affiliateEnabled: false } : {},
      term
        ? {
            OR: [
              { id: term },
              { affiliateCode: { contains: normalizeAffiliateCode(term) || term, mode: 'insensitive' } },
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              { username: { contains: term, mode: 'insensitive' } },
              { user: { email: { contains: term, mode: 'insensitive' } } },
              // Código PCB del afiliador o de alguno de sus referidos.
              { apiSubaccounts: { some: { identifier: { contains: term, mode: 'insensitive' } } } },
              { referrals: { some: { apiSubaccounts: { some: { identifier: { contains: term, mode: 'insensitive' } } } } } },
            ],
          }
        : {},
    ],
  };
  const [rows, promoters, referred, groups] = await Promise.all([
    prisma.clientProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        affiliateCode: true,
        affiliateEnabled: true,
        affiliateEnabledAt: true,
        affiliateDisabledAt: true,
        affiliateBitgetUid: true,
        createdAt: true,
        user: { select: { email: true } },
        referrals: { select: REFERRAL_STATUS_SELECT },
      },
    }),
    prisma.clientProfile.count({ where: PROMOTER_WHERE }),
    prisma.clientProfile.count({ where: { referredByClientId: { not: null } } }),
    prisma.affiliateCommission.groupBy({ by: ['status'], _sum: { amount: true } }),
  ]);
  const perPromoter = rows.length
    ? await prisma.affiliateCommission.groupBy({
        by: ['referrerClientId', 'status'],
        where: { referrerClientId: { in: rows.map((r) => r.id) } },
        _sum: { amount: true },
      })
    : [];
  const totals = commissionTotals(groups);
  res.json({
    ok: true,
    stats: { promoters, referred, pendingAmount: totals.PENDIENTE + totals.APROBADA, paidAmount: totals.PAGADA },
    items: rows.map(({ referrals, user, ...r }) => {
      const mine = commissionTotals(perPromoter.filter((g) => g.referrerClientId === r.id));
      return {
        ...r,
        email: user.email,
        referralsCount: referrals.length,
        activeReferralsCount: referrals.filter((x) => referralStatus(x) === 'ACTIVO').length,
        pendingAmount: mine.PENDIENTE + mine.APROBADA,
        paidAmount: mine.PAGADA,
      };
    }),
  });
});

// Buscador para el alta administrativa / corrección de atribución: por
// código, nombre o correo; solo afiliaciones ACTIVAS. Se usa el CÓDIGO.
const lookupAffiliates = asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json({ ok: true, items: [] });
  const rows = await prisma.clientProfile.findMany({
    where: {
      affiliateEnabled: true,
      affiliateCode: { not: null },
      status: { not: 'INACTIVE' },
      user: { isActive: true },
      OR: [
        { affiliateCode: { contains: normalizeAffiliateCode(term) || term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { user: { email: { contains: term, mode: 'insensitive' } } },
      ],
    },
    take: 10,
    orderBy: { firstName: 'asc' },
    select: { firstName: true, lastName: true, affiliateCode: true, user: { select: { email: true } } },
  });
  res.json({ ok: true, items: rows.map(({ user, ...r }) => ({ ...r, email: user.email })) });
});

const validateForAdmin = asyncHandler(async (req, res) => {
  const referrer = await resolveActiveReferrer(prisma, req.query.code);
  const full = await prisma.clientProfile.findUnique({
    where: { id: referrer.id },
    select: { firstName: true, lastName: true, affiliateCode: true, user: { select: { email: true } } },
  });
  res.json({ ok: true, affiliate: { firstName: full.firstName, lastName: full.lastName, code: full.affiliateCode, email: full.user.email } });
});

const COMMISSION_SELECT = {
  id: true,
  concept: true,
  baseAmount: true,
  commissionType: true,
  commissionValue: true,
  amount: true,
  currency: true,
  status: true,
  occurredAt: true,
  periodStart: true,
  periodEnd: true,
  statementId: true,
  paymentId: true,
  notes: true,
  createdAt: true,
  approvedAt: true,
  paidAt: true,
  cancelledAt: true,
  referrerClientId: true,
  referredClientId: true,
  referred: { select: { firstName: true, lastName: true } },
};
const PAYMENT_SELECT = {
  id: true,
  amount: true,
  currency: true,
  periodLabel: true,
  destinationUid: true,
  reference: true,
  proofDriveFileId: true,
  proofFileName: true,
  status: true,
  statusUpdatedAt: true,
  paidAt: true,
  createdAt: true,
  _count: { select: { commissions: true } },
};
const shapePayment = ({ proofDriveFileId, _count, ...p }) => ({ ...p, hasProof: Boolean(proofDriveFileId), commissionsCount: _count.commissions });

const getAffiliate = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.clientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      affiliateCode: true,
      affiliateEnabled: true,
      affiliateEnabledAt: true,
      affiliateDisabledAt: true,
      affiliateBitgetUid: true,
      affiliateBitgetUidUpdatedAt: true,
      referredAt: true,
      referralSource: true,
      referralCodeUsed: true,
      createdAt: true,
      user: { select: { email: true } },
      apiSubaccounts: { where: { deactivatedAt: null }, orderBy: { slotIndex: 'asc' }, select: { identifier: true, isPrincipal: true } },
      // Afiliador DIRECTO de este cliente: nombre, liga y sus PCB.
      referredBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          affiliateCode: true,
          affiliateEnabled: true,
          apiSubaccounts: { where: { deactivatedAt: null }, orderBy: { slotIndex: 'asc' }, select: { identifier: true, isPrincipal: true } },
        },
      },
      referrals: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          createdAt: true,
          referralSource: true,
          status: true,
          user: { select: { isActive: true } },
          apiSubaccounts: {
            select: { identifier: true, isPrincipal: true, status: true, deactivatedAt: true, process: { select: { isActivated: true } } },
            orderBy: { slotIndex: 'asc' },
          },
        },
      },
    },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  const [config, groups, commissions, payments, audit] = await Promise.all([
    getEffectiveConfig(),
    prisma.affiliateCommission.groupBy({ by: ['status'], where: { referrerClientId: client.id }, _sum: { amount: true } }),
    prisma.affiliateCommission.findMany({ where: { referrerClientId: client.id }, orderBy: { occurredAt: 'desc' }, select: COMMISSION_SELECT }),
    prisma.affiliatePayment.findMany({ where: { referrerClientId: client.id }, orderBy: { createdAt: 'desc' }, select: PAYMENT_SELECT }),
    prisma.affiliateAuditLog.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const origin = resolveFrontendOrigin(req.get('origin'));
  const { referrals, user, referredBy, ...rest } = client;
  res.json({
    ok: true,
    affiliate: {
      ...rest,
      email: user.email,
      link: client.affiliateCode ? buildAffiliateLink(origin, client.affiliateCode) : null,
      referredBy: referredBy
        ? { ...referredBy, link: referredBy.affiliateCode ? buildAffiliateLink(origin, referredBy.affiliateCode) : null }
        : null,
      referrals: referrals.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        username: r.username,
        createdAt: r.createdAt,
        referralSource: r.referralSource,
        status: referralStatus(r),
        accounts: r.apiSubaccounts
          .filter((s) => !s.deactivatedAt)
          .map((s) => ({ pcb: s.identifier, principal: s.isPrincipal, connectionStatus: s.status, activated: Boolean(s.process?.isActivated) })),
      })),
      commissionTotals: commissionTotals(groups),
      commissions,
      payments: payments.map(shapePayment),
      audit,
    },
    config: shapeConfig(config),
  });
});

const setEnabledSchema = z.object({ enabled: z.boolean() });

// ACTIVAR / SUSPENDER afiliador. Suspender solo impide nuevas atribuciones:
// referidos, comisiones y pagos se conservan.
const setAffiliateEnabled = asyncHandler(async (req, res) => {
  const { enabled } = setEnabledSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId }, select: { id: true, affiliateEnabled: true } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (enabled) {
    const { code, generated } = await ensureAffiliateCode(client.id);
    await prisma.clientProfile.update({
      where: { id: client.id },
      data: { affiliateEnabled: true, affiliateEnabledAt: new Date(), affiliateDisabledAt: null },
    });
    if (generated) await logAffiliateEvent(prisma, { action: 'AFFILIATE_CODE_GENERATED', clientId: client.id, actorUserId: req.user.id, details: { code } });
  } else {
    await prisma.clientProfile.update({ where: { id: client.id }, data: { affiliateEnabled: false, affiliateDisabledAt: new Date() } });
  }
  if (client.affiliateEnabled !== enabled) {
    await logAffiliateEvent(prisma, {
      action: enabled ? 'AFFILIATE_ENABLED' : 'AFFILIATE_SUSPENDED',
      clientId: client.id,
      actorUserId: req.user.id,
      details: { by: 'ADMIN', previous: client.affiliateEnabled, next: enabled },
    });
  }
  const updated = await prisma.clientProfile.findUnique({
    where: { id: client.id },
    select: { affiliateCode: true, affiliateEnabled: true, affiliateDisabledAt: true },
  });
  res.json({ ok: true, affiliate: updated });
});

// REGENERAR CÓDIGO (solo ADMIN) — solo si el código no tiene referidos;
// queda auditado con el valor anterior y el nuevo.
const regenerateCode = asyncHandler(async (req, res) => {
  const { previous, code } = await regenerateAffiliateCode(req.params.clientId);
  await logAffiliateEvent(prisma, {
    action: 'AFFILIATE_CODE_REGENERATED',
    clientId: req.params.clientId,
    actorUserId: req.user.id,
    details: { previous, next: code },
  });
  res.json({ ok: true, code });
});

// CORRECCIÓN EXCEPCIONAL DE ATRIBUCIÓN — solo ADMIN, con motivo obligatorio
// y auditoría del valor anterior/nuevo. Nunca crea autoafiliaciones ni
// ciclos. Las comisiones ya registradas conservan su beneficiario histórico.
const reassignSchema = z.object({
  affiliateCode: z.string().trim().max(64).nullable(),
  reason: z.string().trim().min(10, 'Indica el motivo de la corrección (mínimo 10 caracteres).').max(500),
});

const reassignReferrer = asyncHandler(async (req, res) => {
  const { affiliateCode, reason } = reassignSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId }, select: { id: true, referredByClientId: true, referralCodeUsed: true } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  let newReferrerId = null;
  let newCode = null;
  if (affiliateCode) {
    const referrer = await resolveActiveReferrer(prisma, affiliateCode);
    if (referrer.id === client.id) throw ApiError.badRequest('Un cliente no puede ser su propio afiliador.');
    // Evita ciclos: el nuevo afiliador no puede descender de este cliente.
    let cursor = referrer.id;
    for (let depth = 0; cursor && depth < 1000; depth += 1) {
      if (cursor === client.id) throw ApiError.badRequest('Esa corrección crearía una relación circular entre afiliadores.');
      const next = await prisma.clientProfile.findUnique({ where: { id: cursor }, select: { referredByClientId: true } });
      cursor = next?.referredByClientId || null;
    }
    newReferrerId = referrer.id;
    newCode = referrer.affiliateCode;
  }
  if (newReferrerId === client.referredByClientId) throw ApiError.badRequest('El cliente ya tiene asignado ese afiliador.');
  await prisma.clientProfile.update({
    where: { id: client.id },
    data: { referredByClientId: newReferrerId, referredAt: newReferrerId ? new Date() : null, referralSource: newReferrerId ? 'ADMIN' : null, referralCodeUsed: newCode },
  });
  await logAffiliateEvent(prisma, {
    action: 'ATTRIBUTION_CORRECTED',
    clientId: client.id,
    actorUserId: req.user.id,
    details: { previousReferrerClientId: client.referredByClientId, previousCode: client.referralCodeUsed, newReferrerClientId: newReferrerId, newCode, reason },
  });
  res.json({ ok: true });
});

// ==========================================================
// ADMIN — comisiones del afiliador DIRECTO
// ==========================================================
// Las comisiones de cada periodo nacen al emitir el estado de cuenta del
// referido (ver statementController). Aquí ADMIN registra solo AJUSTES
// justificados: el beneficiario lo determina el backend con la relación
// guardada (afiliador directo), nunca el frontend.
const createCommissionSchema = z.object({
  referredClientId: z.string().min(1),
  concept: z.string().trim().min(10, 'Justifica el ajuste (mínimo 10 caracteres).').max(200),
  amount: z.coerce.number({ invalid_type_error: 'Indica el monto del ajuste.' }).positive('El monto debe ser mayor que 0.'),
  occurredAt: z.coerce.date({ invalid_type_error: 'La fecha no es válida.' }),
  notes: z.string().trim().max(500).optional(),
});

const createCommission = asyncHandler(async (req, res) => {
  const data = createCommissionSchema.parse(req.body);
  const referred = await prisma.clientProfile.findUnique({ where: { id: data.referredClientId }, select: { id: true, referredByClientId: true } });
  if (!referred) throw ApiError.notFound('Cliente referido no encontrado');
  if (!referred.referredByClientId) {
    throw ApiError.badRequest('Este cliente no tiene un afiliador directo: no puede generar comisión de afiliado.');
  }
  const commission = await prisma.affiliateCommission.create({
    data: {
      referrerClientId: referred.referredByClientId,
      referredClientId: referred.id,
      concept: data.concept,
      amount: round2(data.amount),
      occurredAt: data.occurredAt,
      notes: data.notes || null,
      status: 'PENDIENTE',
      createdByUserId: req.user.id,
    },
    select: COMMISSION_SELECT,
  });
  await logAffiliateEvent(prisma, {
    action: 'COMMISSION_ADJUSTMENT_CREATED',
    clientId: commission.referrerClientId,
    actorUserId: req.user.id,
    details: { commissionId: commission.id, referredClientId: referred.id, amount: Number(commission.amount), concept: data.concept },
  });
  res.status(201).json({ ok: true, commission });
});

// Revisión de la comisión: PENDIENTE → APROBADA | CANCELADA; APROBADA →
// CANCELADA (solo si no está en un pago). PAGADA solo la pone un PAGO confirmado.
const TRANSITIONS = { APROBADA: ['PENDIENTE'], CANCELADA: ['PENDIENTE', 'APROBADA'] };
const STATUS_FIELDS = {
  APROBADA: (userId) => ({ approvedAt: new Date(), approvedByUserId: userId }),
  CANCELADA: (userId) => ({ cancelledAt: new Date(), cancelledByUserId: userId }),
};
const updateCommissionSchema = z.object({ status: z.enum(['APROBADA', 'CANCELADA']) });

const updateCommissionStatus = asyncHandler(async (req, res) => {
  const { status } = updateCommissionSchema.parse(req.body);
  const commission = await prisma.affiliateCommission.findUnique({ where: { id: req.params.id } });
  if (!commission) throw ApiError.notFound('Comisión no encontrada');
  if (commission.status === status) {
    return res.json({ ok: true, commission: await prisma.affiliateCommission.findUnique({ where: { id: commission.id }, select: COMMISSION_SELECT }) });
  }
  const { count } = await prisma.affiliateCommission.updateMany({
    where: { id: commission.id, status: { in: TRANSITIONS[status] }, paymentId: null },
    data: { status, ...STATUS_FIELDS[status](req.user.id) },
  });
  if (!count) throw ApiError.conflict('Esta comisión no puede pasar a ese estado desde su estado actual.');
  const updated = await prisma.affiliateCommission.findUnique({ where: { id: commission.id }, select: COMMISSION_SELECT });
  await logAffiliateEvent(prisma, {
    action: `COMMISSION_${status}`,
    clientId: commission.referrerClientId,
    actorUserId: req.user.id,
    details: { commissionId: commission.id, previous: commission.status, next: status },
  });
  res.json({ ok: true, commission: updated });
});

// ==========================================================
// ADMIN — pagos al afiliador
// ==========================================================
const parseIds = (v) => {
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const createPaymentSchema = z.object({
  referrerClientId: z.string().min(1),
  commissionIds: z.preprocess(parseIds, z.array(z.string().min(1)).min(1, 'Selecciona al menos una comisión aprobada.')),
  periodLabel: z.string().trim().min(3, 'Indica el periodo del pago.').max(120),
  reference: z.string().trim().max(200).optional(),
  status: z.enum(['PENDIENTE', 'PROCESADO', 'PAGADO']).default('PENDIENTE'),
});

// REGISTRAR PAGO — agrupa comisiones APROBADAS del afiliador. El importe es
// la suma de esas comisiones; el UID de destino es el que registró el
// afiliador. Las comisiones pasan a PAGADA solo si el pago es PAGADO.
const createPayment = asyncHandler(async (req, res) => {
  const data = createPaymentSchema.parse(req.body);
  // Perfil completo: driveStorage lo necesita para ubicar su carpeta "Pagos".
  const referrer = await prisma.clientProfile.findUnique({ where: { id: data.referrerClientId } });
  if (!referrer) throw ApiError.notFound('Afiliador no encontrado');
  if (!referrer.affiliateBitgetUid) throw ApiError.badRequest('El afiliador todavía no registró su UID de Bitget de recepción.');
  const ids = [...new Set(data.commissionIds)];
  const commissions = await prisma.affiliateCommission.findMany({
    where: { id: { in: ids }, referrerClientId: referrer.id, status: 'APROBADA', paymentId: null },
    select: { id: true, amount: true },
  });
  if (commissions.length !== ids.length) {
    throw ApiError.badRequest('Solo se pueden pagar comisiones APROBADAS de este afiliador que no estén en otro pago.');
  }
  const amount = round2(commissions.reduce((sum, c) => sum + Number(c.amount), 0));

  // Comprobante opcional (imagen o PDF) en la carpeta "Pagos" del afiliador.
  const file = req.file || null;
  let proof = null;
  if (file) {
    if (!EVIDENCE_MIME.includes(file.mimetype) || !matchesSignature(file)) {
      throw ApiError.badRequest('El comprobante debe ser una imagen (JPG, PNG, WEBP) o un PDF válido.');
    }
    if (!(await driveStorage.isConfigured())) {
      throw ApiError.serviceUnavailable('No pudimos conectar con Google Drive para guardar el comprobante.');
    }
    const folderId = await driveStorage.getOrCreateSubfolder(referrer, 'payments');
    const fileName = safeFileName(`Pago_afiliado_${data.periodLabel}_${file.originalname}`);
    const uploaded = await driveStorage.uploadFileToDrive(file.buffer, { folderId, fileName, mimeType: file.mimetype });
    proof = { proofDriveFileId: uploaded.id, proofFileName: fileName, proofMimeType: file.mimetype };
  }

  let payment;
  try {
    payment = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.affiliatePayment.create({
        data: {
          referrerClientId: referrer.id,
          amount,
          periodLabel: data.periodLabel,
          destinationUid: referrer.affiliateBitgetUid,
          reference: data.reference || null,
          status: data.status,
          statusUpdatedAt: now,
          paidAt: data.status === 'PAGADO' ? now : null,
          createdByUserId: req.user.id,
          ...(proof || {}),
        },
      });
      // Condicionado: si otra operación tomó alguna comisión, se revierte todo.
      const { count } = await tx.affiliateCommission.updateMany({
        where: { id: { in: ids }, referrerClientId: referrer.id, status: 'APROBADA', paymentId: null },
        data: { paymentId: created.id, ...(data.status === 'PAGADO' ? { status: 'PAGADA', paidAt: now, paidByUserId: req.user.id } : {}) },
      });
      if (count !== ids.length) throw ApiError.conflict('Alguna comisión cambió mientras se registraba el pago. Intenta nuevamente.');
      return created;
    });
  } catch (err) {
    if (proof) await driveStorage.deleteDriveFileOnlyWhenAuthorized(proof.proofDriveFileId, { authorized: true }).catch(() => {});
    throw err;
  }
  await logAffiliateEvent(prisma, {
    action: 'PAYMENT_CREATED',
    clientId: referrer.id,
    actorUserId: req.user.id,
    details: { paymentId: payment.id, amount, commissionIds: ids, status: data.status, destinationUid: referrer.affiliateBitgetUid },
  });
  if (data.status === 'PAGADO') await notifyPaid(referrer.id, payment);
  res.status(201).json({ ok: true, payment });
});

function notifyPaid(referrerClientId, payment) {
  return notifyClient(referrerClientId, {
    title: 'Pago de comisión de afiliado',
    message: `QLC registró el pago de tu comisión de afiliado (${Number(payment.amount)} ${payment.currency}, periodo ${payment.periodLabel}).`,
    type: 'success',
    templateKey: 'affiliate_payment_paid',
    templateParams: { amount: String(Number(payment.amount)), period: payment.periodLabel },
  }).catch(() => {});
}

// PENDIENTE → PROCESADO | PAGADO | RECHAZADO; PROCESADO → PAGADO | RECHAZADO.
const PAYMENT_TRANSITIONS = { PROCESADO: ['PENDIENTE'], PAGADO: ['PENDIENTE', 'PROCESADO'], RECHAZADO: ['PENDIENTE', 'PROCESADO'] };
const updatePaymentSchema = z.object({ status: z.enum(['PROCESADO', 'PAGADO', 'RECHAZADO']) });

const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { status } = updatePaymentSchema.parse(req.body);
  const payment = await prisma.affiliatePayment.findUnique({ where: { id: req.params.id } });
  if (!payment) throw ApiError.notFound('Pago no encontrado');
  if (payment.status === status) return res.json({ ok: true, payment });
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.affiliatePayment.updateMany({
      where: { id: payment.id, status: { in: PAYMENT_TRANSITIONS[status] } },
      data: { status, statusUpdatedAt: now, ...(status === 'PAGADO' ? { paidAt: now } : {}) },
    });
    if (!count) throw ApiError.conflict('Este pago no puede pasar a ese estado desde su estado actual.');
    if (status === 'PAGADO') {
      await tx.affiliateCommission.updateMany({ where: { paymentId: payment.id }, data: { status: 'PAGADA', paidAt: now, paidByUserId: req.user.id } });
    } else if (status === 'RECHAZADO') {
      // Las comisiones vuelven a quedar APROBADAS y disponibles para otro pago.
      await tx.affiliateCommission.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });
    }
    return tx.affiliatePayment.findUnique({ where: { id: payment.id } });
  });
  await logAffiliateEvent(prisma, {
    action: `PAYMENT_${status}`,
    clientId: payment.referrerClientId,
    actorUserId: req.user.id,
    details: { paymentId: payment.id, previous: payment.status, next: status },
  });
  if (status === 'PAGADO') await notifyPaid(payment.referrerClientId, updated);
  res.json({ ok: true, payment: updated });
});

const downloadPaymentProof = asyncHandler(async (req, res) => {
  const payment = await prisma.affiliatePayment.findUnique({ where: { id: req.params.id } });
  if (!payment || !payment.proofDriveFileId) throw ApiError.notFound('Comprobante no encontrado');
  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(payment.proofDriveFileId);
  res.setHeader('Content-Type', mimeType || payment.proofMimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || payment.proofFileName || 'comprobante')}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = {
  validateAffiliateCode,
  getPublicDistribution,
  getConfig,
  updateConfig,
  listAffiliates,
  lookupAffiliates,
  validateForAdmin,
  getAffiliate,
  setAffiliateEnabled,
  regenerateCode,
  reassignReferrer,
  createCommission,
  updateCommissionStatus,
  createPayment,
  updatePaymentStatus,
  downloadPaymentProof,
};
