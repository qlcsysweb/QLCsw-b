const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');
const { computeCapitalState, canCreateNewInvitation, CAPITAL_INCREASE_INCLUDE } = require('../utils/capitalIncreaseState');

// CORRECCIÓN 7/8 — Invitación para aumento de saldo operativo. Solo ADMIN
// crea invitaciones y autoriza/procesa la solicitud aceptada. La
// distribución del capital entre subcuentas/API la realiza SIEMPRE el
// CLIENTE desde su propio panel (ver client/capitalIncreaseController.js) —
// el admin NUNCA arma la distribución por el cliente.

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
  message: z.string().optional(),
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
      message: data.message || null,
      createdByUserId: req.user.id,
    },
  });

  await notifyClient(client.id, {
    title: 'Invitación para aumento de saldo operativo',
    message: `QLC te invita a solicitar un aumento de saldo operativo de hasta ${data.maxAmount} USDT. Tienes ${data.validityDays} días para responder.`,
    type: 'info',
    templateKey: 'capital_invitation_created',
    templateParams: { maxAmount: String(data.maxAmount), validityDays: String(data.validityDays) },
  });

  res.status(201).json({ ok: true, invitation });
});

// CORRECCIÓN 7/8: el admin autoriza/procesa la solicitud aceptada — esto
// habilita al CLIENTE para distribuir el monto autorizado entre sus propias
// subcuentas/API (en bloques de 20 USDT). El admin nunca escribe montos por
// subcuenta.
const authorizeRequest = asyncHandler(async (req, res) => {
  const request = await prisma.capitalIncreaseRequest.findUnique({
    where: { id: req.params.requestId },
    include: { invitation: true },
  });
  if (!request) throw ApiError.notFound('Solicitud no encontrada');
  if (request.status !== 'EN_PROCESO') {
    throw ApiError.conflict('Esta solicitud ya no está en el estado inicial de procesamiento.');
  }

  const updated = await prisma.capitalIncreaseRequest.update({
    where: { id: request.id },
    data: { status: 'DISTRIBUCION_EN_PROCESO' },
  });

  await notifyClient(request.invitation.clientId, {
    title: 'Ya puedes distribuir tu aumento de saldo',
    message: `QLC autorizó tu solicitud de ${request.requestedAmount} USDT. Ingresa a "Aumento de saldo" para distribuirlo entre tus subcuentas/API.`,
    type: 'info',
    templateKey: 'capital_request_authorized',
    templateParams: { amount: String(request.requestedAmount) },
  });

  res.json({ ok: true, request: updated });
});

module.exports = {
  listForClient,
  createInvitation,
  authorizeRequest,
};
