const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyClient } = require('../../utils/notify');
const { computeCapitalState, CAPITAL_INCREASE_INCLUDE } = require('../../utils/capitalIncreaseState');

// CORRECCIÓN 7/8 — el cliente NUNCA puede crear/modificar invitaciones,
// pero SÍ es el único responsable de distribuir el monto autorizado entre
// sus propias subcuentas/API, en bloques de 20 USDT. Ownership siempre por
// req.clientProfile.id, nunca por un id que el cliente envíe.

const BLOCK_SIZE = 20;

function isValidBlockAmount(amount) {
  return Number.isFinite(amount) && amount >= BLOCK_SIZE && amount % BLOCK_SIZE === 0;
}

const getMine = asyncHandler(async (req, res) => {
  const lastInvitation = await prisma.capitalIncreaseInvitation.findFirst({
    where: { clientId: req.clientProfile.id },
    orderBy: { createdAt: 'desc' },
    include: CAPITAL_INCREASE_INCLUDE,
  });
  const current = computeCapitalState(lastInvitation);
  res.json({ ok: true, state: current.state, invitation: current.invitation, request: current.request || null });
});

const acceptInvitationSchema = z.object({ amount: z.coerce.number() });

const acceptInvitation = asyncHandler(async (req, res) => {
  const { amount } = acceptInvitationSchema.parse(req.body);
  if (!isValidBlockAmount(amount)) {
    throw ApiError.badRequest(`El monto debe ser de al menos ${BLOCK_SIZE} USDT y múltiplo de ${BLOCK_SIZE} USDT.`);
  }

  const invitation = await prisma.capitalIncreaseInvitation.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!invitation) throw ApiError.notFound('Invitación no encontrada');
  if (invitation.status !== 'DESBLOQUEADA' || new Date(invitation.expiresAt) < new Date()) {
    throw ApiError.conflict('Esta invitación ya no está disponible.');
  }
  if (amount > Number(invitation.maxAmount)) {
    throw ApiError.badRequest(`El monto solicitado no puede superar el máximo autorizado (${invitation.maxAmount} USDT).`);
  }

  const deadlineAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const request = await prisma.$transaction(async (tx) => {
    await tx.capitalIncreaseInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACEPTADA', respondedAt: new Date() },
    });
    return tx.capitalIncreaseRequest.create({
      data: { invitationId: invitation.id, requestedAmount: amount, deadlineAt },
    });
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Solicitud de aumento de saldo enviada',
    message: `Tu solicitud de ${amount} USDT fue enviada. QLC dispone de 72 horas para procesarla y autorizar la distribución.`,
    type: 'info',
    templateKey: 'capital_request_submitted',
    templateParams: { amount: String(amount) },
  });

  res.status(201).json({ ok: true, request });
});

const rejectInvitation = asyncHandler(async (req, res) => {
  const invitation = await prisma.capitalIncreaseInvitation.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!invitation) throw ApiError.notFound('Invitación no encontrada');
  if (invitation.status !== 'DESBLOQUEADA') throw ApiError.conflict('Esta invitación ya no está disponible.');

  const updated = await prisma.capitalIncreaseInvitation.update({
    where: { id: invitation.id },
    data: { status: 'RECHAZADA', respondedAt: new Date() },
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Invitación rechazada',
    message: 'Rechazaste la invitación para aumento de saldo operativo. Podrás recibir futuras invitaciones cuando QLC las emita.',
    type: 'info',
    templateKey: 'capital_invitation_rejected',
    templateParams: {},
  });

  res.json({ ok: true, invitation: updated });
});

// Carga (o recupera) la solicitud propia del cliente en estado
// DISTRIBUCION_EN_PROCESO, validando ownership real vía el join a
// invitation.clientId — nunca confiando en un requestId aislado.
async function loadOwnDistributableRequest(clientId, requestId) {
  const request = await prisma.capitalIncreaseRequest.findUnique({
    where: { id: requestId },
    include: { invitation: true, distribution: { include: { items: true } } },
  });
  if (!request || request.invitation.clientId !== clientId) {
    throw ApiError.notFound('Solicitud no encontrada');
  }
  if (request.status !== 'DISTRIBUCION_EN_PROCESO') {
    throw ApiError.conflict('Esta solicitud todavía no está autorizada para distribución, o ya fue completada.');
  }
  if (request.distribution?.publishedAt) {
    throw ApiError.conflict('Esta distribución ya fue confirmada.');
  }
  return request;
}

// CORRECCIÓN 8: el cliente selecciona/deselecciona subcuentas — cada una
// recibe siempre un bloque fijo de 20 USDT. Nunca se supera el monto
// autorizado ni las 20 subcuentas del cliente (ya limitado estructuralmente).
const toggleDistributionItem = asyncHandler(async (req, res) => {
  const schema = z.object({ apiSubaccountId: z.string().min(1), selected: z.boolean() });
  const { apiSubaccountId, selected } = schema.parse(req.body);

  const request = await loadOwnDistributableRequest(req.clientProfile.id, req.params.id);

  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: apiSubaccountId, clientId: req.clientProfile.id },
  });
  if (!subaccount) throw ApiError.badRequest('Esa subcuenta/API no te pertenece.');

  let distribution = request.distribution;
  if (!distribution) {
    distribution = await prisma.capitalDistribution.create({
      data: { requestId: request.id },
      include: { items: true },
    });
  }

  const existingItem = distribution.items.find((i) => i.apiSubaccountId === apiSubaccountId);

  if (selected) {
    if (existingItem) return res.json({ ok: true });
    const currentTotal = distribution.items.reduce((sum, i) => sum + Number(i.amount), 0);
    if (currentTotal + BLOCK_SIZE > Number(request.requestedAmount)) {
      throw ApiError.conflict('No puedes seleccionar más subcuentas: superarías el monto autorizado.');
    }
    await prisma.capitalDistributionItem.create({
      data: { distributionId: distribution.id, apiSubaccountId, amount: BLOCK_SIZE, order: distribution.items.length },
    });
  } else if (existingItem) {
    await prisma.capitalDistributionItem.delete({ where: { id: existingItem.id } });
  }

  res.json({ ok: true });
});

// CORRECCIÓN 8: solo puede confirmarse cuando el total seleccionado es
// EXACTAMENTE igual al monto autorizado — cierra el ciclo (COMPLETADA).
const confirmDistribution = asyncHandler(async (req, res) => {
  const request = await loadOwnDistributableRequest(req.clientProfile.id, req.params.id);
  const items = request.distribution?.items || [];
  const distributedTotal = items.reduce((sum, i) => sum + Number(i.amount), 0);
  const requestedAmount = Number(request.requestedAmount);

  if (!request.distribution) {
    throw ApiError.badRequest('Selecciona al menos una subcuenta antes de confirmar.');
  }
  if (distributedTotal !== requestedAmount) {
    throw ApiError.conflict(
      `El total distribuido (${distributedTotal} USDT) debe ser exactamente igual al monto autorizado (${requestedAmount} USDT).`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.capitalDistribution.update({
      where: { id: request.distribution.id },
      data: { publishedAt: new Date() },
    });
    await tx.capitalIncreaseRequest.update({
      where: { id: request.id },
      data: { status: 'COMPLETADA' },
    });
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Distribución de saldo confirmada',
    message: `Distribuiste ${distributedTotal} USDT entre tus subcuentas/API correctamente.`,
    type: 'success',
    templateKey: 'capital_distribution_confirmed',
    templateParams: { amount: String(distributedTotal) },
  });

  res.json({ ok: true });
});

module.exports = { getMine, acceptInvitation, rejectInvitation, toggleDistributionItem, confirmDistribution };
