const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyClient } = require('../../utils/notify');
const { computeCapitalState, CAPITAL_INCREASE_INCLUDE } = require('../../utils/capitalIncreaseState');

// CORRECCIÓN 7 — el cliente NUNCA puede crear/modificar invitaciones,
// solicitudes o distribuciones: solo puede responder a lo que el admin ya
// publicó, y solo lo suyo (ownership siempre por req.clientProfile.id,
// nunca por un id que el cliente envíe).

const getMine = asyncHandler(async (req, res) => {
  const lastInvitation = await prisma.capitalIncreaseInvitation.findFirst({
    where: { clientId: req.clientProfile.id },
    orderBy: { createdAt: 'desc' },
    include: CAPITAL_INCREASE_INCLUDE,
  });
  const current = computeCapitalState(lastInvitation);
  res.json({ ok: true, state: current.state, invitation: current.invitation, request: current.request || null });
});

const acceptInvitationSchema = z.object({ amount: z.coerce.number().positive() });

const acceptInvitation = asyncHandler(async (req, res) => {
  const { amount } = acceptInvitationSchema.parse(req.body);
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

  // Punto de notificación 4/6: confirmación de solicitud enviada + plazo 72h.
  await notifyClient(req.clientProfile.id, {
    title: 'Solicitud de aumento de saldo enviada',
    message: `Tu solicitud de ${amount} USDT fue enviada. QLC dispone de 72 horas para procesarla y emitir las instrucciones de distribución.`,
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

  // Punto de notificación 5/6: confirmación de rechazo — el cliente puede
  // recibir futuras invitaciones.
  await notifyClient(req.clientProfile.id, {
    title: 'Invitación rechazada',
    message: 'Rechazaste la invitación para aumento de saldo operativo. Podrás recibir futuras invitaciones cuando QLC las emita.',
    type: 'info',
    templateKey: 'capital_invitation_rejected',
    templateParams: {},
  });

  res.json({ ok: true, invitation: updated });
});

// CORRECCIÓN 7: marcar instrucciones como leídas — única acción del cliente
// sobre una distribución ya publicada; registra el timestamp y cierra el ciclo.
const markInstructionsRead = asyncHandler(async (req, res) => {
  const request = await prisma.capitalIncreaseRequest.findUnique({
    where: { id: req.params.id },
    include: { invitation: true },
  });
  if (!request || request.invitation.clientId !== req.clientProfile.id) {
    throw ApiError.notFound('Solicitud no encontrada');
  }
  if (request.status !== 'INSTRUCCIONES_EMITIDAS') {
    throw ApiError.conflict('Todavía no hay instrucciones publicadas para marcar como leídas.');
  }

  const updated = await prisma.capitalIncreaseRequest.update({
    where: { id: request.id },
    data: { status: 'COMPLETADA', readAt: new Date() },
  });

  // Punto de notificación 6/6: confirmación de cierre del ciclo.
  await notifyClient(req.clientProfile.id, {
    title: 'Instrucciones marcadas como leídas',
    message: 'Confirmaste la lectura de las instrucciones de distribución de tu aumento de saldo operativo.',
    type: 'info',
    templateKey: 'capital_instructions_read',
    templateParams: {},
  });

  res.json({ ok: true, request: updated });
});

module.exports = { getMine, acceptInvitation, rejectInvitation, markInstructionsRead };
