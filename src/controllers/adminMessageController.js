const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyUser } = require('../utils/notify');

/*
 * CORREGIR.xlsx ADMIN 14 — mensajería manual admin→cliente. Reutiliza
 * Notification (kind=MANUAL, senderUserId=admin) en vez de una tabla
 * paralela: el mensaje aparece en las notificaciones del cliente y queda
 * en el historial para siempre (excluido de la limpieza automática de 34
 * días — ver client/notificationController.js).
 *
 * Cada mensaje se guarda en BD, aparece como notificación interna y, en la
 * MISMA acción, se envía por correo al email real del cliente (User.email).
 * Si el correo falla, el mensaje interno NO se pierde: queda guardado con
 * emailSent=false y el motivo en emailError (visible solo para el admin).
 */

const listForClient = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.clientId },
    select: { userId: true },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  // El hilo completo con este cliente: todo lo que el ADMIN le envió
  // (userId=cliente, senderUserId=algún admin) y todo lo que el CLIENTE
  // envió (el cliente guarda su propia copia con userId=él mismo también).
  const messages = await prisma.notification.findMany({
    where: { userId: client.userId, kind: 'MANUAL' },
    orderBy: { createdAt: 'desc' },
    include: {
      sender: {
        select: {
          role: true,
          adminProfile: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  // Al abrir el hilo, este admin marca como leídos SUS propios avisos de
  // mensajes recibidos de este cliente (cada admin tiene su propia copia y
  // su propio estado de lectura — ver notifyAdmins).
  await prisma.notification.updateMany({
    where: { userId: req.user.id, kind: 'MANUAL', senderUserId: client.userId, isRead: false },
    data: { isRead: true },
  });

  res.json({ ok: true, messages });
});

// BANDEJA DE ENTRADA — un renglón por cliente que le haya escrito a este
// admin (su propia copia de cada mensaje MANUAL recibido), con el mensaje
// más reciente y cuántos de esos siguen sin leer. Cada admin ve su propio
// estado de lectura (igual que el resto de las notificaciones).
const listInbox = asyncHandler(async (req, res) => {
  const received = await prisma.notification.findMany({
    where: { userId: req.user.id, kind: 'MANUAL', senderUserId: { not: null } },
    orderBy: { createdAt: 'desc' },
    include: {
      sender: {
        select: {
          clientProfile: { select: { id: true, firstName: true, lastName: true, username: true } },
        },
      },
    },
  });

  const bySender = new Map();
  for (const m of received) {
    // Un admin nunca aparece como remitente de sí mismo aquí (esto es
    // exclusivamente "lo que me escribieron los clientes").
    if (!m.sender?.clientProfile) continue;
    const key = m.senderUserId;
    if (!bySender.has(key)) {
      bySender.set(key, {
        client: m.sender.clientProfile,
        lastTitle: m.title,
        lastMessage: m.message,
        lastAt: m.createdAt,
        unreadCount: 0,
      });
    }
    if (!m.isRead) bySender.get(key).unreadCount += 1;
  }

  const inbox = Array.from(bySender.values()).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  res.json({ ok: true, inbox });
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

  // notifyUser: guarda el mensaje + notificación interna y envía el correo
  // al email real del cliente dentro de la misma petición.
  const notification = await notifyUser(client.userId, {
    title,
    message,
    type: 'info',
    kind: 'MANUAL',
    senderUserId: req.user.id,
  });

  res.status(201).json({ ok: true, message: notification });
});

module.exports = { listForClient, listInbox, sendMessage };
