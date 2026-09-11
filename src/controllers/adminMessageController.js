const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/*
 * CORREGIR.xlsx ADMIN 14 — mensajería manual admin→cliente. Reutiliza
 * Notification (kind=MANUAL, senderUserId=admin) en vez de una tabla
 * paralela: el mensaje aparece en las notificaciones del cliente y queda
 * en el historial para siempre (excluido de la limpieza automática de 34
 * días — ver client/notificationController.js).
 */

const listForClient = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.clientId },
    select: { userId: true },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const messages = await prisma.notification.findMany({
    where: { userId: client.userId, kind: 'MANUAL' },
    orderBy: { createdAt: 'desc' },
    include: { sender: { select: { adminProfile: { select: { firstName: true, lastName: true } } } } },
  });
  res.json({ ok: true, messages });
});

const sendMessageSchema = z.object({
  title: z.string().min(1, 'El asunto es obligatorio').max(150),
  message: z.string().min(1, 'El contenido es obligatorio').max(2000),
});

const sendMessage = asyncHandler(async (req, res) => {
  const { title, message } = sendMessageSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.clientId },
    select: { userId: true },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const notification = await prisma.notification.create({
    data: {
      userId: client.userId,
      title,
      message,
      type: 'info',
      kind: 'MANUAL',
      senderUserId: req.user.id,
    },
  });

  res.status(201).json({ ok: true, message: notification });
});

module.exports = { listForClient, sendMessage };
