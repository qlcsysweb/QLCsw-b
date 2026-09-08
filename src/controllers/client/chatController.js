const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

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
    session = await prisma.chatSession.update({ where: { id: session.id }, data: { status: 'CLOSED' } });
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
    await prisma.chatSession.update({ where: { id: session.id }, data: { status: 'CLOSED' } });
    throw ApiError.badRequest('El tiempo de la sesión de chat ha finalizado');
  }

  const message = await prisma.chatMessage.create({
    data: { chatSessionId: session.id, senderUserId: req.user.id, content },
  });

  res.status(201).json({ ok: true, message });
});

module.exports = { listChatSessions, getSession, startSession, sendMessage };
