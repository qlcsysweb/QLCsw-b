const { z } = require('zod');
const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyAdmins, notifyUser } = require('../../utils/notify');

/*
 * MENSAJERÍA INTERNA — buzón admin↔cliente (distinto del chat de citas y de
 * los casos de soporte). Reutiliza exactamente el mismo modelo Notification
 * ya usado para la mensajería admin→cliente (kind=MANUAL): un mensaje del
 * cliente crea, en la MISMA acción:
 *   1) Un registro propio (userId=el propio cliente, senderUserId=el propio
 *      cliente, sin correo) — así el cliente ve su propio mensaje enviado
 *      dentro de su historial, con una sola consulta simple.
 *   2) Una notificación real para CADA administrador activo (userId=ese
 *      admin, senderUserId=el cliente), cada una con su propio correo — el
 *      mismo mecanismo que ya usa notifyAdmins() para pagos/documentos/etc.
 * El hilo completo de un cliente (lo que envió y lo que recibió) siempre se
 * consulta igual: todas las notificaciones MANUAL con userId=ese cliente.
 */

// Solo lectura — a propósito nunca marca nada como leído aquí, porque esto
// también lo usa el layout para el contador de "Mensajes" sin leer (si
// marcara como leído en cada sondeo, el badge desaparecería solo sin que el
// cliente realmente haya abierto la sección). Ver markAllRead más abajo.
const listMyMessages = asyncHandler(async (req, res) => {
  const messages = await prisma.notification.findMany({
    where: { userId: req.user.id, kind: 'MANUAL' },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { role: true, adminProfile: { select: { firstName: true, lastName: true } } } } },
  });
  res.json({ ok: true, messages });
});

// Se llama explícitamente cuando el cliente ABRE la sección de Mensajes
// (nunca desde el sondeo del contador).
const markAllRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, kind: 'MANUAL', isRead: false, senderUserId: { not: req.user.id } },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

const sendMessageSchema = z.object({
  title: z.string().min(1, 'El asunto es obligatorio').max(150),
  message: z.string().min(1, 'El contenido es obligatorio').max(2000),
});

const sendMessage = asyncHandler(async (req, res) => {
  const { title, message } = sendMessageSchema.parse(req.body);

  // Copia propia del mensaje enviado (nunca genera correo a uno mismo).
  const own = await notifyUser(req.user.id, {
    title,
    message,
    type: 'info',
    kind: 'MANUAL',
    senderUserId: req.user.id,
    skipEmail: true,
  });

  // Un aviso real (con correo) para cada administrador activo.
  await notifyAdmins({
    title,
    message,
    type: 'info',
    kind: 'MANUAL',
    senderUserId: req.user.id,
  });

  res.status(201).json({ ok: true, message: own });
});

module.exports = { listMyMessages, markAllRead, sendMessage };
