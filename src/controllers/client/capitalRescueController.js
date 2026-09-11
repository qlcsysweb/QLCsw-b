const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const documentStorage = require('../../services/documentStorage');
const { notifyClient } = require('../../utils/notify');
const { computeRescueState, CAPITAL_RESCUE_INCLUDE } = require('../../utils/capitalRescueState');

// CORRECCIÓN 4 — el cliente solo puede aceptar/rechazar la invitación y
// confirmar su monto de participación; nunca genera ni modifica las
// instrucciones de depósito/devolución (siempre las determina QLC).
// Ownership siempre por req.clientProfile.id, nunca por un id enviado.

const getMine = asyncHandler(async (req, res) => {
  const lastInvitation = await prisma.capitalRescueInvitation.findFirst({
    where: { clientId: req.clientProfile.id },
    orderBy: { createdAt: 'desc' },
    include: CAPITAL_RESCUE_INCLUDE,
  });
  const current = computeRescueState(lastInvitation);
  res.json({
    ok: true,
    state: current.state,
    invitation: current.invitation,
    participation: current.participation || null,
  });
});

const rejectInvitation = asyncHandler(async (req, res) => {
  const invitation = await prisma.capitalRescueInvitation.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!invitation) throw ApiError.notFound('Invitación no encontrada');
  if (invitation.status !== 'DESBLOQUEADA') throw ApiError.conflict('Esta invitación ya no está disponible.');

  const updated = await prisma.capitalRescueInvitation.update({
    where: { id: invitation.id },
    data: { status: 'RECHAZADA', respondedAt: new Date() },
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Invitación de capital temporal rechazada',
    message: 'Rechazaste la invitación para participación mediante capital temporal para rescate.',
    type: 'info',
    templateKey: 'rescue_invitation_rejected',
    templateParams: {},
  });

  res.json({ ok: true, invitation: updated });
});

const confirmParticipationSchema = z.object({ amount: z.coerce.number().positive() });

const confirmParticipation = asyncHandler(async (req, res) => {
  const { amount } = confirmParticipationSchema.parse(req.body);
  const invitation = await prisma.capitalRescueInvitation.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!invitation) throw ApiError.notFound('Invitación no encontrada');
  if (invitation.status !== 'DESBLOQUEADA' || new Date(invitation.expiresAt) < new Date()) {
    throw ApiError.conflict('Esta invitación ya no está disponible.');
  }
  if (amount > Number(invitation.requestedAmount)) {
    throw ApiError.badRequest(`El monto de participación no puede superar el capital solicitado (${invitation.requestedAmount} USDT).`);
  }

  const participation = await prisma.$transaction(async (tx) => {
    await tx.capitalRescueInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACEPTADA', respondedAt: new Date() },
    });
    return tx.capitalRescueParticipation.create({
      data: { invitationId: invitation.id, participationAmount: amount },
    });
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Participación confirmada',
    message: `Confirmaste tu participación con ${amount} USDT de capital temporal. QLC preparará las instrucciones de depósito.`,
    type: 'info',
    templateKey: 'rescue_participation_confirmed',
    templateParams: { amount: String(amount) },
  });

  res.status(201).json({ ok: true, participation });
});

const downloadComprobante = asyncHandler(async (req, res) => {
  const participation = await prisma.capitalRescueParticipation.findFirst({
    where: { id: req.params.id, invitation: { clientId: req.clientProfile.id } },
  });
  if (!participation) throw ApiError.notFound('Participación no encontrada');
  if (!participation.comprobantePdfDriveFileId) throw ApiError.notFound('El comprobante todavía no está disponible');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(participation.comprobantePdfDriveFileId);
  res.setHeader('Content-Type', mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || participation.comprobantePdfFileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = { getMine, rejectInvitation, confirmParticipation, downloadComprobante };
