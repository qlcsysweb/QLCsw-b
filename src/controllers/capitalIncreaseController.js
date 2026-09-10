const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');
const { computeCapitalState, canCreateNewInvitation, CAPITAL_INCREASE_INCLUDE } = require('../utils/capitalIncreaseState');

// CORRECCIÓN 7 — Invitación para aumento de saldo operativo (solo ADMIN
// puede crear invitaciones/distribuciones; el cliente nunca puede).

const listForClient = asyncHandler(async (req, res) => {
  const invitations = await prisma.capitalIncreaseInvitation.findMany({
    where: { clientId: req.params.clientId },
    orderBy: { createdAt: 'desc' },
    include: CAPITAL_INCREASE_INCLUDE,
  });
  const current = computeCapitalState(invitations[0] || null);
  res.json({
    ok: true,
    invitations,
    currentState: current.state,
    canCreateInvitation: canCreateNewInvitation(current),
  });
});

const createInvitationSchema = z.object({
  currentBalance: z.coerce.number().nonnegative(),
  maxAmount: z.coerce.number().positive(),
  validityDays: z.coerce.number().int().positive().default(10),
});

const createInvitation = asyncHandler(async (req, res) => {
  const data = createInvitationSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const lastInvitation = await prisma.capitalIncreaseInvitation.findFirst({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    include: CAPITAL_INCREASE_INCLUDE,
  });
  const current = computeCapitalState(lastInvitation);
  if (!canCreateNewInvitation(current)) {
    throw ApiError.conflict('Este cliente ya tiene una invitación activa en curso.');
  }

  const expiresAt = new Date(Date.now() + data.validityDays * 24 * 60 * 60 * 1000);
  const invitation = await prisma.capitalIncreaseInvitation.create({
    data: {
      clientId: client.id,
      currentBalance: data.currentBalance,
      maxAmount: data.maxAmount,
      validityDays: data.validityDays,
      expiresAt,
      createdByUserId: req.user.id,
    },
  });

  // Punto de notificación 1/6: invitación creada y disponible para el cliente.
  await notifyClient(client.id, {
    title: 'Invitación para aumento de saldo operativo',
    message: `QLC te invita a solicitar un aumento de saldo operativo de hasta ${data.maxAmount} USDT. Tienes ${data.validityDays} días para responder.`,
    type: 'info',
    templateKey: 'capital_invitation_created',
    templateParams: { maxAmount: String(data.maxAmount), validityDays: String(data.validityDays) },
  });

  res.status(201).json({ ok: true, invitation });
});

// CORRECCIÓN 7: el admin "abre" la distribución de una solicitud aceptada
// (nace vacía) para empezar a repartir el monto solicitado entre las
// subcuentas/API reales del cliente.
const startDistribution = asyncHandler(async (req, res) => {
  const request = await prisma.capitalIncreaseRequest.findUnique({
    where: { id: req.params.requestId },
    include: { invitation: true, distribution: true },
  });
  if (!request) throw ApiError.notFound('Solicitud no encontrada');
  if (request.distribution) return res.json({ ok: true, distribution: request.distribution });
  if (request.status !== 'EN_PROCESO') {
    throw ApiError.conflict('Esta solicitud ya no está en el estado inicial de procesamiento.');
  }

  const distribution = await prisma.$transaction(async (tx) => {
    const created = await tx.capitalDistribution.create({ data: { requestId: request.id } });
    await tx.capitalIncreaseRequest.update({
      where: { id: request.id },
      data: { status: 'DISTRIBUCION_EN_PROCESO' },
    });
    return created;
  });

  // Punto de notificación 2/6: QLC comenzó a procesar la distribución.
  await notifyClient(request.invitation.clientId, {
    title: 'Tu solicitud está siendo procesada',
    message: 'QLC ya está preparando la distribución de tu aumento de saldo operativo entre tus subcuentas/API.',
    type: 'info',
    templateKey: 'capital_distribution_started',
    templateParams: {},
  });

  res.status(201).json({ ok: true, distribution: { ...distribution, items: [] } });
});

const upsertItemSchema = z.object({
  apiSubaccountId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

const upsertDistributionItem = asyncHandler(async (req, res) => {
  const { apiSubaccountId, amount } = upsertItemSchema.parse(req.body);
  const distribution = await prisma.capitalDistribution.findUnique({
    where: { id: req.params.distributionId },
    include: { request: true, items: true },
  });
  if (!distribution) throw ApiError.notFound('Distribución no encontrada');
  if (distribution.publishedAt) throw ApiError.conflict('Esta distribución ya fue publicada y no puede modificarse.');

  // CORRECCIÓN 7: SIEMPRE una subcuenta/API real del mismo cliente dueño de
  // la solicitud — nunca un nombre ficticio ni de otro cliente.
  const request = await prisma.capitalIncreaseRequest.findUnique({
    where: { id: distribution.requestId },
    include: { invitation: true },
  });
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: apiSubaccountId, clientId: request.invitation.clientId },
  });
  if (!subaccount) throw ApiError.badRequest('Esa subcuenta/API no pertenece a este cliente.');

  const otherItemsTotal = distribution.items
    .filter((i) => i.apiSubaccountId !== apiSubaccountId)
    .reduce((sum, i) => sum + Number(i.amount), 0);
  if (otherItemsTotal + amount > Number(request.requestedAmount) + 0.000001) {
    throw ApiError.conflict('El monto distribuido no puede superar el monto solicitado por el cliente.');
  }

  const existing = distribution.items.find((i) => i.apiSubaccountId === apiSubaccountId);
  const item = existing
    ? await prisma.capitalDistributionItem.update({ where: { id: existing.id }, data: { amount } })
    : await prisma.capitalDistributionItem.create({
        data: { distributionId: distribution.id, apiSubaccountId, amount, order: distribution.items.length },
      });

  res.status(existing ? 200 : 201).json({ ok: true, item });
});

const removeDistributionItem = asyncHandler(async (req, res) => {
  const item = await prisma.capitalDistributionItem.findUnique({
    where: { id: req.params.itemId },
    include: { distribution: true },
  });
  if (!item) throw ApiError.notFound('Elemento no encontrado');
  if (item.distribution.publishedAt) throw ApiError.conflict('Esta distribución ya fue publicada y no puede modificarse.');

  await prisma.capitalDistributionItem.delete({ where: { id: item.id } });
  res.json({ ok: true });
});

// CORRECCIÓN 7: no se puede publicar hasta que el total distribuido sea
// EXACTAMENTE igual al monto solicitado por el cliente.
const publishDistribution = asyncHandler(async (req, res) => {
  const distribution = await prisma.capitalDistribution.findUnique({
    where: { id: req.params.distributionId },
    include: {
      items: true,
      request: { include: { invitation: true } },
    },
  });
  if (!distribution) throw ApiError.notFound('Distribución no encontrada');
  if (distribution.publishedAt) throw ApiError.conflict('Esta distribución ya fue publicada.');

  const distributedTotal = distribution.items.reduce((sum, i) => sum + Number(i.amount), 0);
  const requestedAmount = Number(distribution.request.requestedAmount);
  if (Math.abs(distributedTotal - requestedAmount) > 0.000001) {
    throw ApiError.conflict(
      `El total distribuido (${distributedTotal}) debe ser exactamente igual al monto solicitado (${requestedAmount}) antes de publicar.`
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const publishedDistribution = await tx.capitalDistribution.update({
      where: { id: distribution.id },
      data: { publishedAt: new Date() },
      include: { items: { include: { apiSubaccount: true }, orderBy: { order: 'asc' } } },
    });
    await tx.capitalIncreaseRequest.update({
      where: { id: distribution.requestId },
      data: { status: 'INSTRUCCIONES_EMITIDAS' },
    });
    return publishedDistribution;
  });

  // Punto de notificación 3/6: instrucciones de distribución disponibles.
  await notifyClient(distribution.request.invitation.clientId, {
    title: 'Instrucciones de distribución de saldo disponibles',
    message: 'QLC publicó las instrucciones de distribución de tu aumento de saldo operativo. Revísalas en tu portal.',
    type: 'info',
    templateKey: 'capital_distribution_published',
    templateParams: {},
  });

  res.json({ ok: true, distribution: updated });
});

module.exports = {
  listForClient,
  createInvitation,
  startDistribution,
  upsertDistributionItem,
  removeDistributionItem,
  publishDistribution,
};
