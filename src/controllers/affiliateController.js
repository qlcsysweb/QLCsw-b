const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');
const {
  normalizeAffiliateCode,
  getAffiliateConfig,
  resolveActiveReferrer,
  ensureAffiliateCode,
  referralStatus,
  REFERRAL_STATUS_SELECT,
  resolveFrontendOrigin,
  buildAffiliateLink,
  commissionTotals,
  logAffiliateEvent,
} = require('../services/affiliateService');

// ==========================================================
// PÚBLICO — validar una invitación antes de mostrar el registro
// ==========================================================
// Solo responde si el código es válido y el nombre (de pila) del afiliador:
// nada más de su perfil.
const validateAffiliateCode = asyncHandler(async (req, res) => {
  const referrer = await resolveActiveReferrer(prisma, req.query.code);
  res.json({ ok: true, valid: true, code: referrer.affiliateCode, inviterFirstName: referrer.firstName });
});

// ==========================================================
// ADMIN — configuración del programa
// ==========================================================
const shapeConfig = (c) => ({
  enabled: c.enabled,
  commissionType: c.commissionType,
  commissionValue: c.commissionValue != null ? Number(c.commissionValue) : null,
  updatedAt: c.updatedAt,
});

const getConfig = asyncHandler(async (req, res) => {
  res.json({ ok: true, config: shapeConfig(await getAffiliateConfig()) });
});

const configSchema = z.object({
  enabled: z.boolean(),
  commissionType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  // Vacío/null = QLC todavía no definió el valor (nunca se inventa uno).
  commissionValue: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().positive('La comisión debe ser mayor que 0.').nullable()),
}).refine((d) => d.commissionType !== 'PERCENTAGE' || d.commissionValue == null || d.commissionValue <= 100, {
  message: 'El porcentaje no puede ser mayor que 100.',
  path: ['commissionValue'],
});

const updateConfig = asyncHandler(async (req, res) => {
  const data = configSchema.parse(req.body);
  const current = await getAffiliateConfig();
  const values = { ...data, updatedByUserId: req.user.id };
  const saved = current.id
    ? await prisma.affiliateConfiguration.update({ where: { id: current.id }, data: values })
    : await prisma.affiliateConfiguration.create({ data: values });
  await logAffiliateEvent(prisma, { action: 'PROGRAM_CONFIG_UPDATED', actorUserId: req.user.id, details: data });
  res.json({ ok: true, config: shapeConfig(saved) });
});

// ==========================================================
// ADMIN — promotores
// ==========================================================
// Promotor = cliente con código de afiliado o con referidos directos.
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
              { affiliateCode: { contains: normalizeAffiliateCode(term) || term, mode: 'insensitive' } },
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              { username: { contains: term, mode: 'insensitive' } },
              { user: { email: { contains: term, mode: 'insensitive' } } },
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
        affiliateDisabledAt: true,
        user: { select: { email: true } },
        _count: { select: { referrals: true } },
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
    items: rows.map(({ _count, user, ...r }) => {
      const mine = commissionTotals(perPromoter.filter((g) => g.referrerClientId === r.id));
      return { ...r, email: user.email, referralsCount: _count.referrals, pendingAmount: mine.PENDIENTE + mine.APROBADA, paidAmount: mine.PAGADA };
    }),
  });
});

// Buscador para el alta administrativa ("Con afiliado"): por código, nombre
// o correo; solo afiliaciones ACTIVAS. El admin elige un resultado y se
// envía su CÓDIGO — nunca un ID escrito a mano.
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

// Validación del código en el alta administrativa (mismo criterio que el
// registro público), devolviendo el nombre completo porque es el ADMIN.
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
  notes: true,
  createdAt: true,
  approvedAt: true,
  paidAt: true,
  cancelledAt: true,
  referrerClientId: true,
  referredClientId: true,
  referred: { select: { firstName: true, lastName: true } },
};

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
      createdAt: true,
      user: { select: { email: true } },
      referredBy: { select: { id: true, firstName: true, lastName: true, affiliateCode: true } },
      referrals: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, firstName: true, lastName: true, username: true, createdAt: true, referralSource: true, ...REFERRAL_STATUS_SELECT },
      },
    },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  const [config, groups, commissions] = await Promise.all([
    getAffiliateConfig(),
    prisma.affiliateCommission.groupBy({ by: ['status'], where: { referrerClientId: client.id }, _sum: { amount: true } }),
    prisma.affiliateCommission.findMany({ where: { referrerClientId: client.id }, orderBy: { occurredAt: 'desc' }, select: COMMISSION_SELECT }),
  ]);
  const { referrals, user, ...rest } = client;
  res.json({
    ok: true,
    affiliate: {
      ...rest,
      email: user.email,
      link: client.affiliateCode ? buildAffiliateLink(resolveFrontendOrigin(req.get('origin')), client.affiliateCode) : null,
      referrals: referrals.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        username: r.username,
        createdAt: r.createdAt,
        referralSource: r.referralSource,
        status: referralStatus(r),
      })),
      commissionTotals: commissionTotals(groups),
      commissions,
    },
    config: shapeConfig(config),
  });
});

const setEnabledSchema = z.object({ enabled: z.boolean() });

// ACTIVAR / DESACTIVAR afiliación de un cliente. Desactivar solo impide
// registros NUEVOS con su código: los referidos y comisiones se conservan.
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
    await logAffiliateEvent(prisma, { action: enabled ? 'AFFILIATE_ENABLED' : 'AFFILIATE_DISABLED', clientId: client.id, actorUserId: req.user.id, details: { by: 'ADMIN' } });
  }
  const updated = await prisma.clientProfile.findUnique({
    where: { id: client.id },
    select: { affiliateCode: true, affiliateEnabled: true, affiliateDisabledAt: true },
  });
  res.json({ ok: true, affiliate: updated });
});

// ==========================================================
// ADMIN — comisiones del afiliador DIRECTO
// ==========================================================
const createCommissionSchema = z.object({
  // El REFERIDO por el que se genera la comisión (se elige en la lista de
  // referidos del promotor). El beneficiario NO se recibe: lo determina el
  // backend con la relación guardada (afiliador directo).
  referredClientId: z.string().min(1),
  concept: z.string().trim().min(3, 'Describe el concepto de la comisión.').max(200),
  baseAmount: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().positive().optional()),
  amount: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().positive().optional()),
  occurredAt: z.coerce.date({ invalid_type_error: 'La fecha no es válida.' }),
  notes: z.string().trim().max(500).optional(),
});

const round2 = (n) => Math.round(n * 100) / 100;

const createCommission = asyncHandler(async (req, res) => {
  const data = createCommissionSchema.parse(req.body);
  const referred = await prisma.clientProfile.findUnique({
    where: { id: data.referredClientId },
    select: { id: true, firstName: true, lastName: true, referredByClientId: true },
  });
  if (!referred) throw ApiError.notFound('Cliente referido no encontrado');
  // Beneficiario = afiliador DIRECTO guardado. Nunca se recorre la cadena.
  if (!referred.referredByClientId) {
    throw ApiError.badRequest('Este cliente no tiene un afiliador directo: no puede generar comisión de afiliado.');
  }

  // Monto según la configuración vigente (copiada en el registro). Si QLC
  // todavía no definió el valor, el monto se captura manualmente.
  const config = await getAffiliateConfig();
  const rate = config.commissionValue != null ? Number(config.commissionValue) : null;
  let amount;
  let baseAmount = null;
  let commissionType = null;
  let commissionValue = null;
  if (rate != null && config.commissionType === 'PERCENTAGE') {
    if (!data.baseAmount) throw ApiError.badRequest('Indica el monto base sobre el que se calcula el porcentaje.');
    baseAmount = data.baseAmount;
    amount = round2((data.baseAmount * rate) / 100);
    commissionType = 'PERCENTAGE';
    commissionValue = rate;
  } else if (rate != null && config.commissionType === 'FIXED_AMOUNT') {
    amount = rate;
    commissionType = 'FIXED_AMOUNT';
    commissionValue = rate;
  } else {
    if (!data.amount) throw ApiError.badRequest('QLC todavía no definió la comisión del programa: indica el monto de esta comisión.');
    amount = round2(data.amount);
  }
  if (!(amount > 0)) throw ApiError.badRequest('El monto de la comisión debe ser mayor que 0.');

  const commission = await prisma.affiliateCommission.create({
    data: {
      referrerClientId: referred.referredByClientId,
      referredClientId: referred.id,
      concept: data.concept,
      baseAmount,
      commissionType,
      commissionValue,
      amount,
      occurredAt: data.occurredAt,
      notes: data.notes || null,
      status: 'PENDIENTE',
      createdByUserId: req.user.id,
    },
    select: COMMISSION_SELECT,
  });
  await logAffiliateEvent(prisma, {
    action: 'COMMISSION_CREATED',
    clientId: commission.referrerClientId,
    actorUserId: req.user.id,
    details: { commissionId: commission.id, referredClientId: referred.id, amount },
  });
  res.status(201).json({ ok: true, commission });
});

// Transiciones permitidas (ADMIN): PENDIENTE → APROBADA | CANCELADA;
// APROBADA → PAGADA | CANCELADA. PAGADA y CANCELADA son definitivas.
const TRANSITIONS = { APROBADA: ['PENDIENTE'], PAGADA: ['APROBADA'], CANCELADA: ['PENDIENTE', 'APROBADA'] };
const STATUS_FIELDS = {
  APROBADA: (userId) => ({ approvedAt: new Date(), approvedByUserId: userId }),
  PAGADA: (userId) => ({ paidAt: new Date(), paidByUserId: userId }),
  CANCELADA: (userId) => ({ cancelledAt: new Date(), cancelledByUserId: userId }),
};
const updateCommissionSchema = z.object({ status: z.enum(['APROBADA', 'PAGADA', 'CANCELADA']) });

const updateCommissionStatus = asyncHandler(async (req, res) => {
  const { status } = updateCommissionSchema.parse(req.body);
  const commission = await prisma.affiliateCommission.findUnique({ where: { id: req.params.id } });
  if (!commission) throw ApiError.notFound('Comisión no encontrada');
  if (commission.status === status) {
    return res.json({ ok: true, commission: await prisma.affiliateCommission.findUnique({ where: { id: commission.id }, select: COMMISSION_SELECT }) });
  }
  // Atómico y condicionado al estado de origen: un doble clic no aplica la
  // transición dos veces ni salta pasos.
  const { count } = await prisma.affiliateCommission.updateMany({
    where: { id: commission.id, status: { in: TRANSITIONS[status] } },
    data: { status, ...STATUS_FIELDS[status](req.user.id) },
  });
  if (!count) throw ApiError.conflict('Esta comisión no puede pasar a ese estado desde su estado actual.');
  const updated = await prisma.affiliateCommission.findUnique({ where: { id: commission.id }, select: COMMISSION_SELECT });
  await logAffiliateEvent(prisma, {
    action: `COMMISSION_${status}`,
    clientId: commission.referrerClientId,
    actorUserId: req.user.id,
    details: { commissionId: commission.id, from: commission.status, to: status },
  });
  if (status !== 'CANCELADA') {
    await notifyClient(commission.referrerClientId, {
      title: status === 'PAGADA' ? 'Comisión de afiliado pagada' : 'Comisión de afiliado aprobada',
      message: `Tu comisión de afiliado "${commission.concept}" (${Number(commission.amount)} ${commission.currency}) fue ${status === 'PAGADA' ? 'pagada' : 'aprobada'} por QLC.`,
      type: 'success',
      templateKey: 'affiliate_commission_updated',
      templateParams: { concept: commission.concept, amount: String(Number(commission.amount)), status },
    }).catch(() => {});
  }
  res.json({ ok: true, commission: updated });
});

module.exports = {
  validateAffiliateCode,
  getConfig,
  updateConfig,
  listAffiliates,
  lookupAffiliates,
  validateForAdmin,
  getAffiliate,
  setAffiliateEnabled,
  createCommission,
  updateCommissionStatus,
};
