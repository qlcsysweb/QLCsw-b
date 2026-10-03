const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const driveStorage = require('../../services/driveStorageService');
const {
  getAffiliateConfig,
  getEffectiveConfig,
  isRecordFresh,
  ensureAffiliateCode,
  referralStatus,
  promoterVisibleName,
  resolveFrontendOrigin,
  buildAffiliateLink,
  buildAffiliateQr,
  commissionTotals,
  logAffiliateEvent,
  apiKeyTail,
} = require('../../services/affiliateService');

/*
 * AFFILIATE DASHBOARD (QLC Affiliate Program, portal del cliente).
 *
 * Todo se resuelve desde req.clientProfile (el cliente autenticado) — nunca
 * desde un ID de la URL o del body: un afiliador no puede consultar
 * referidos, comisiones ni pagos de otro (IDOR).
 *
 * TODA la información sale de registros internos de QLC en NeonDB (estados
 * administrativos, capital confirmado, estados de cuenta emitidos). La
 * plataforma NO se conecta a Bitget: no consulta balances, movimientos ni
 * operaciones, y la API Key solo se usa para mostrar su terminación como
 * referencia visual (••••7F2A). Nunca se envía la clave completa ni el Secret.
 */
const MILESTONES = ['API', 'FUNDS', 'PAYMENT', 'ACTIVATION'];

const effectiveStatementStatus = (st) =>
  st.status === 'PENDIENTE_DE_PAGO' && new Date(st.expiresAt) <= new Date() ? 'VENCIDO_SIN_PAGAR' : st.status;

// Datos de una subcuenta/API de un referido, tal como los puede ver el
// afiliador. Todo es un ESTADO ADMINISTRATIVO almacenado en la plataforma
// (misma fuente que ven el cliente y el admin).
function shapeReferralAccount(s, staleDays) {
  const conditions = s.process?.conditions || [];
  const capitals = s.capitalDistributionReports || [];
  const statements = s.statements || [];
  const capital = capitals[0] || null;
  const lastStatement = statements[0] || null;

  // SALDO REGISTRADO para esta API: el dato más reciente que QLC registró en
  // la plataforma — saldo final del último estado de cuenta emitido o capital
  // confirmado por QLC. Nunca una consulta al exchange. Si no existe o
  // supera la antigüedad configurada → "Sin actualizar".
  const candidates = [
    lastStatement && { amount: Number(lastStatement.endingBalance), updatedAt: lastStatement.generatedAt, source: 'ESTADO_DE_CUENTA' },
    capital && { amount: Number(capital.amount), updatedAt: capital.reviewedAt || capital.reportedAt, source: 'CAPITAL_CONFIRMADO' },
  ].filter(Boolean);
  candidates.sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt));
  const latest = candidates[0] || null;

  // HISTORIAL REGISTRADO POR QLC: los DEPÓSITOS que QLC realiza al cliente
  // en esta API (fecha, tipo de movimiento e importe), registrados por
  // administración. Nunca movimientos consultados a Bitget; los anulados no
  // se muestran.
  const history = (s.qlcDeposits || []).map((d) => ({
    date: d.depositedAt,
    type: 'DEPOSITO_QLC',
    periodStart: null,
    periodEnd: null,
    amount: Number(d.amount),
    status: 'REGISTRADO',
  }));

  return {
    // PCB asignado por QLC al registrar la API (formato actual del sistema).
    pcb: s.identifier || null,
    principal: Boolean(s.isPrincipal),
    apiKeyTail: apiKeyTail(s.apiKeyEncrypted),
    connectionStatus: s.status,
    activated: Boolean(s.process?.isActivated),
    milestones: MILESTONES.map((type) => {
      const c = conditions.find((x) => x.type === type);
      return { type, status: c?.status || 'PENDING', updatedAt: c?.updatedAt || null };
    }),
    // CAPITAL CONFIRMADO: última confirmación de capital APROBADA por QLC.
    confirmedCapital: capital ? { amount: Number(capital.amount), updatedAt: capital.reviewedAt || capital.reportedAt } : null,
    registeredBalance: latest ? { ...latest, fresh: isRecordFresh(latest.updatedAt, staleDays) } : null,
    history,
  };
}

// Select ACOTADO de cada subcuenta del referido: apiKeyEncrypted solo para
// calcular la terminación en el backend; ni Secret ni Passphrase se leen.
const REFERRAL_ACCOUNT_SELECT = {
  // Solo para agrupar comisiones por cuenta en el backend; no se envía.
  id: true,
  identifier: true,
  isPrincipal: true,
  status: true,
  deactivatedAt: true,
  apiKeyEncrypted: true,
  process: { select: { isActivated: true, conditions: { where: { type: { not: 'WALLET' } }, select: { type: true, status: true, updatedAt: true } } } },
  capitalDistributionReports: {
    where: { status: 'APROBADO' },
    orderBy: { reviewedAt: 'desc' },
    take: 12,
    select: { amount: true, reviewedAt: true, reportedAt: true },
  },
  qlcDeposits: {
    where: { voidedAt: null },
    orderBy: { depositedAt: 'desc' },
    take: 24,
    select: { amount: true, depositedAt: true },
  },
  statements: {
    where: { status: { not: 'BORRADOR' } },
    orderBy: { periodEnd: 'desc' },
    take: 12,
    select: { periodStart: true, periodEnd: true, resultAmount: true, endingBalance: true, status: true, generatedAt: true, expiresAt: true },
  },
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
  paidAt: true,
  createdAt: true,
};
const shapePayment = ({ proofDriveFileId, ...p }) => ({ ...p, amount: Number(p.amount), hasProof: Boolean(proofDriveFileId) });

const getMyAffiliate = asyncHandler(async (req, res) => {
  const me = req.clientProfile;
  const [config, referrals, groups, commissions, payments] = await Promise.all([
    getEffectiveConfig(),
    prisma.clientProfile.findMany({
      where: { referredByClientId: me.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        status: true,
        user: { select: { isActive: true } },
        apiSubaccounts: { where: { deactivatedAt: null }, orderBy: { slotIndex: 'asc' }, select: REFERRAL_ACCOUNT_SELECT },
      },
    }),
    prisma.affiliateCommission.groupBy({ by: ['status'], where: { referrerClientId: me.id }, _sum: { amount: true } }),
    prisma.affiliateCommission.findMany({
      where: { referrerClientId: me.id },
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true,
        concept: true,
        amount: true,
        currency: true,
        status: true,
        occurredAt: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        referredClientId: true,
        // Cuenta (API) del estado de cuenta que originó la comisión.
        statement: { select: { apiSubaccountId: true } },
        referred: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.affiliatePayment.findMany({ where: { referrerClientId: me.id }, orderBy: { createdAt: 'desc' }, select: PAYMENT_SELECT }),
  ]);

  // COMISIONES INDIVIDUALES POR API: cada comisión de periodo pertenece a la
  // cuenta (API) de su estado de cuenta; los ajustes manuales quedan a nivel
  // del referido. Totales por estado en cada nivel.
  const shapeCommission = ({ referred, statement, referredClientId, ...c }) => ({ ...c, amount: Number(c.amount) });
  const totalsOf = (list) =>
    list.reduce(
      (acc, c) => ({ ...acc, [c.status]: Math.round((acc[c.status] + Number(c.amount)) * 100) / 100 }),
      { PENDIENTE: 0, APROBADA: 0, PAGADA: 0, CANCELADA: 0 }
    );
  const items = referrals.map((r) => {
    const mine = commissions.filter((c) => c.referredClientId === r.id);
    const accountIds = new Set(r.apiSubaccounts.map((a) => a.id));
    const adjustments = mine.filter((c) => !c.statement || !accountIds.has(c.statement.apiSubaccountId));
    return {
      // Clave opaca solo para la lista (no da acceso a nada).
      key: r.id.slice(-8),
      initials: promoterVisibleName(r),
      registeredAt: r.createdAt,
      status: referralStatus(r),
      accounts: r.apiSubaccounts.map((acc) => {
        const accCommissions = mine.filter((c) => c.statement?.apiSubaccountId === acc.id);
        const { id, ...shaped } = { id: acc.id, ...shapeReferralAccount(acc, config.balanceStaleDays) };
        return { ...shaped, commissions: { totals: totalsOf(accCommissions), history: accCommissions.map(shapeCommission) } };
      }),
      // Ajustes manuales justificados por QLC (no ligados a una API).
      adjustments: { totals: totalsOf(adjustments), history: adjustments.map(shapeCommission) },
    };
  });
  const origin = resolveFrontendOrigin(req.get('origin'));
  const suspended = Boolean(me.affiliateDisabledAt) && !me.affiliateEnabled;

  res.json({
    ok: true,
    program: {
      enabled: config.enabled,
      affiliateSharePct: Number(config.affiliateSharePct),
      balanceStaleDays: Number(config.balanceStaleDays),
    },
    affiliate: {
      code: me.affiliateCode,
      enabled: Boolean(me.affiliateEnabled),
      // Activo / Suspendido (controlado por administración).
      state: me.affiliateEnabled ? 'ACTIVO' : suspended ? 'SUSPENDIDO' : 'SIN_LIGA',
      link: me.affiliateCode ? buildAffiliateLink(origin, me.affiliateCode) : null,
      bitgetUid: me.affiliateBitgetUid || null,
      bitgetUidUpdatedAt: me.affiliateBitgetUidUpdatedAt || null,
      // Crear la liga exige UID registrado y que administración no lo haya suspendido.
      canActivate: config.enabled && !me.affiliateEnabled && !suspended && Boolean(me.affiliateBitgetUid),
    },
    stats: { referred: items.length, active: items.filter((i) => i.status === 'ACTIVO').length },
    referrals: items,
    commissions: {
      totals: commissionTotals(groups),
      history: commissions.map(({ referred, statement, referredClientId, ...c }) => ({ ...c, amount: Number(c.amount), referredInitials: promoterVisibleName(referred) })),
    },
    payments: payments.map(shapePayment),
  });
});

// UID DE BITGET del afiliador — dato de RECEPCIÓN de sus comisiones. Se puede
// guardar/editar en cualquier momento; cada cambio queda en la bitácora. No
// implica ninguna conexión con la cuenta Bitget del afiliador.
const uidSchema = z.object({
  bitgetUid: z
    .string({ required_error: 'Indica tu UID de Bitget.' })
    .trim()
    .regex(/^\d{5,20}$/, 'El UID de Bitget debe contener solo números (5 a 20 dígitos).'),
});

const updateMyBitgetUid = asyncHandler(async (req, res) => {
  const { bitgetUid } = uidSchema.parse(req.body);
  const me = req.clientProfile;
  if (me.affiliateBitgetUid === bitgetUid) return res.json({ ok: true, bitgetUid });
  const updated = await prisma.clientProfile.update({
    where: { id: me.id },
    data: { affiliateBitgetUid: bitgetUid, affiliateBitgetUidUpdatedAt: new Date() },
    select: { affiliateBitgetUid: true, affiliateBitgetUidUpdatedAt: true },
  });
  await logAffiliateEvent(prisma, {
    action: 'AFFILIATE_BITGET_UID_UPDATED',
    clientId: me.id,
    actorUserId: req.user.id,
    details: { previous: me.affiliateBitgetUid || null, next: bitgetUid },
  });
  res.json({ ok: true, bitgetUid: updated.affiliateBitgetUid, updatedAt: updated.affiliateBitgetUidUpdatedAt });
});

// CREAR LIGA — genera el código único (si no existe) y activa la afiliación.
// Requiere UID de Bitget registrado. Idempotente: no genera duplicados.
const activateMyAffiliate = asyncHandler(async (req, res) => {
  const me = req.clientProfile;
  const config = await getAffiliateConfig();
  if (!config.enabled) throw ApiError.badRequest('El programa de afiliados no está activo en este momento.');
  if (me.affiliateDisabledAt && !me.affiliateEnabled) {
    throw ApiError.forbidden('Tu afiliación fue desactivada por QLC. Contacta al equipo de QLC para reactivarla.');
  }
  if (!me.affiliateBitgetUid) throw ApiError.badRequest('Registra tu UID de Bitget antes de crear tu liga de afiliación.');
  const { code, generated } = await ensureAffiliateCode(me.id);
  if (!me.affiliateEnabled) {
    await prisma.clientProfile.updateMany({
      where: { id: me.id, affiliateEnabled: false, affiliateDisabledAt: null },
      data: { affiliateEnabled: true, affiliateEnabledAt: new Date() },
    });
  }
  if (generated) await logAffiliateEvent(prisma, { action: 'AFFILIATE_CODE_GENERATED', clientId: me.id, actorUserId: req.user.id, details: { code } });
  if (!me.affiliateEnabled) await logAffiliateEvent(prisma, { action: 'AFFILIATE_ENABLED', clientId: me.id, actorUserId: req.user.id, details: { by: 'CLIENT' } });
  res.json({ ok: true, code });
});

// QR del enlace REAL del propio cliente (librería `qrcode` del backend).
const getMyAffiliateQr = asyncHandler(async (req, res) => {
  const me = req.clientProfile;
  if (!me.affiliateCode || !me.affiliateEnabled) throw ApiError.badRequest('Tu enlace de afiliación no está activo.');
  const link = buildAffiliateLink(resolveFrontendOrigin(req.query.origin || req.get('origin')), me.affiliateCode);
  res.json({ ok: true, link, qrDataUrl: await buildAffiliateQr(link) });
});

// Comprobante de un pago PROPIO (se valida la pertenencia antes de servirlo).
const downloadMyPaymentProof = asyncHandler(async (req, res) => {
  const payment = await prisma.affiliatePayment.findFirst({
    where: { id: req.params.id, referrerClientId: req.clientProfile.id },
    select: { proofDriveFileId: true, proofFileName: true, proofMimeType: true },
  });
  if (!payment || !payment.proofDriveFileId) throw ApiError.notFound('Comprobante no encontrado');
  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(payment.proofDriveFileId);
  res.setHeader('Content-Type', mimeType || payment.proofMimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || payment.proofFileName || 'comprobante')}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = { getMyAffiliate, updateMyBitgetUid, activateMyAffiliate, getMyAffiliateQr, downloadMyPaymentProof };
