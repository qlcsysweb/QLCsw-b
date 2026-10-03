const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const {
  getAffiliateConfig,
  ensureAffiliateCode,
  referralStatus,
  REFERRAL_STATUS_SELECT,
  promoterVisibleName,
  resolveFrontendOrigin,
  buildAffiliateLink,
  buildAffiliateQr,
  commissionTotals,
  logAffiliateEvent,
} = require('../../services/affiliateService');

/*
 * PANEL DE PROMOTOR (cliente). Todo se resuelve desde req.clientProfile (el
 * cliente autenticado) — nunca desde un ID de la URL o del body, así que un
 * cliente no puede consultar referidos ni comisiones de otro (IDOR).
 *
 * Del referido solo se expone lo necesario para la relación de afiliación:
 * nombre visible (nombre + inicial), fecha de registro, estado general y las
 * comisiones generadas PARA ESTE promotor. Nunca API, documentos, pagos,
 * estados de cuenta, saldos/capital, conversaciones ni datos de 2FA.
 */
const getMyAffiliate = asyncHandler(async (req, res) => {
  const me = req.clientProfile;
  const [config, referrals, groups, commissions] = await Promise.all([
    getAffiliateConfig(),
    prisma.clientProfile.findMany({
      where: { referredByClientId: me.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, firstName: true, lastName: true, createdAt: true, ...REFERRAL_STATUS_SELECT },
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
        paidAt: true,
        referred: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const items = referrals.map((r) => ({
    // Clave opaca solo para la lista (no da acceso a nada).
    key: r.id.slice(-8),
    name: promoterVisibleName(r),
    registeredAt: r.createdAt,
    status: referralStatus(r),
  }));
  const origin = resolveFrontendOrigin(req.get('origin'));

  res.json({
    ok: true,
    program: { enabled: config.enabled },
    affiliate: {
      code: me.affiliateCode,
      enabled: Boolean(me.affiliateEnabled),
      disabledByAdmin: Boolean(me.affiliateDisabledAt),
      link: me.affiliateCode ? buildAffiliateLink(origin, me.affiliateCode) : null,
      // El cliente puede activar su enlace por primera vez; si un admin lo
      // desactivó, solo un admin puede reactivarlo.
      canActivate: config.enabled && !me.affiliateEnabled && !me.affiliateDisabledAt,
    },
    stats: { referred: items.length, active: items.filter((i) => i.status === 'ACTIVO').length },
    referrals: items,
    commissions: {
      totals: commissionTotals(groups),
      history: commissions.map(({ referred, ...c }) => ({ ...c, referredName: promoterVisibleName(referred) })),
    },
  });
});

// ACTIVAR MI ENLACE — genera el código único (si no existe) y activa la
// afiliación. Idempotente: repetirlo no cambia el código.
const activateMyAffiliate = asyncHandler(async (req, res) => {
  const me = req.clientProfile;
  const config = await getAffiliateConfig();
  if (!config.enabled) throw ApiError.badRequest('El programa de afiliados no está activo en este momento.');
  if (me.affiliateDisabledAt) {
    throw ApiError.forbidden('Tu afiliación fue desactivada por QLC. Contacta al equipo de QLC para reactivarla.');
  }
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

// QR del enlace REAL del propio cliente (generado con la librería `qrcode`
// del backend, la misma del 2FA). El origen se valida contra la lista blanca.
const getMyAffiliateQr = asyncHandler(async (req, res) => {
  const me = req.clientProfile;
  if (!me.affiliateCode || !me.affiliateEnabled) throw ApiError.badRequest('Tu enlace de afiliación no está activo.');
  const link = buildAffiliateLink(resolveFrontendOrigin(req.query.origin || req.get('origin')), me.affiliateCode);
  res.json({ ok: true, link, qrDataUrl: await buildAffiliateQr(link) });
});

module.exports = { getMyAffiliate, activateMyAffiliate, getMyAffiliateQr };
