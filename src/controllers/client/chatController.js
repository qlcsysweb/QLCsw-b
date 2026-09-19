const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { closeExpiredChatSession } = require('../../utils/chatSessionExpiry');
const { generateChatSessionPdf } = require('../../utils/pdf/chatSessionPdf');

function isExpired(session) {
  return session.endsAt && new Date() > new Date(session.endsAt);
}

const listChatSessions = asyncHandler(async (req, res) => {
  const sessions = await prisma.chatSession.findMany({
    where: { clientId: req.clientProfile.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, sessions });
});

// CORREGIR(2).xlsx CLIENTE 28 — botón "Entrar al chat" en la cita ya
// autorizada: resuelve directamente la sesión asociada sin que el cliente
// tenga que buscarla manualmente en Soporte.
const getSessionByAppointment = asyncHandler(async (req, res) => {
  const session = await prisma.chatSession.findFirst({
    where: { appointmentId: req.params.appointmentId, clientId: req.clientProfile.id },
  });
  if (!session) throw ApiError.notFound('Sesión de chat no encontrada');
  res.json({ ok: true, session });
});

async function getOwnSessionOrThrow(req) {
  const session = await prisma.chatSession.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!session) throw ApiError.notFound('Sesión de chat no encontrada');
  return session;
}

const getSession = asyncHandler(async (req, res) => {
  let session = await getOwnSessionOrThrow(req);

  if (session.status === 'ACTIVE' && isExpired(session)) {
    session = await closeExpiredChatSession(session);
  }

  const messages = await prisma.chatMessage.findMany({
    where: { chatSessionId: session.id },
    orderBy: { createdAt: 'asc' },
  });

  res.json({ ok: true, session, messages });
});

const startSession = asyncHandler(async (req, res) => {
  const session = await getOwnSessionOrThrow(req);
  if (session.status !== 'SCHEDULED') throw ApiError.badRequest('La sesión ya fue iniciada o cerrada');

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + session.durationMinutes * 60 * 1000);

  const updated = await prisma.chatSession.update({
    where: { id: session.id },
    data: { status: 'ACTIVE', startedAt, endsAt },
  });

  res.json({ ok: true, session: updated });
});

const sendMessageSchema = z.object({ content: z.string().min(1).max(2000) });

const sendMessage = asyncHandler(async (req, res) => {
  const { content } = sendMessageSchema.parse(req.body);
  const session = await getOwnSessionOrThrow(req);

  if (session.status !== 'ACTIVE') throw ApiError.badRequest('El chat no está activo');
  if (isExpired(session)) {
    await closeExpiredChatSession(session);
    throw ApiError.badRequest('El tiempo de la sesión de chat ha finalizado');
  }

  const message = await prisma.chatMessage.create({
    data: { chatSessionId: session.id, senderUserId: req.user.id, content },
  });

  res.status(201).json({ ok: true, message });
});

// PDF de la conversación de la sesión propia — misma verificación de
// ownership (clientId) que el resto de este controlador.
const downloadSessionPdf = asyncHandler(async (req, res) => {
  const session = await prisma.chatSession.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
    include: {
      client: { select: { firstName: true, lastName: true, userId: true } },
      admin: { select: { id: true, adminProfile: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!session) throw ApiError.notFound('Sesión de chat no encontrada');

  const messages = await prisma.chatMessage.findMany({
    where: { chatSessionId: session.id },
    orderBy: { createdAt: 'asc' },
  });

  const participantNames = {};
  if (session.client) {
    participantNames[session.client.userId] = `${session.client.firstName} ${session.client.lastName}`.trim();
  }
  if (session.admin) {
    const name = `${session.admin.adminProfile?.firstName || ''} ${session.admin.adminProfile?.lastName || ''}`.trim();
    participantNames[session.admin.id] = name || 'Administrador QLC';
  }

  const pdf = await generateChatSessionPdf({ session, client: session.client, messages, participantNames });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="chat-${session.id}.pdf"`);
  res.send(pdf);
});

module.exports = {
  listChatSessions,
  getSessionByAppointment,
  getSession,
  startSession,
  sendMessage,
  downloadSessionPdf,
};
