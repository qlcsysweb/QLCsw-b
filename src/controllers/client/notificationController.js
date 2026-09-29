const { z } = require('zod');
const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');

// CORRECCIÓN 25: las notificaciones se eliminan automáticamente 34 días
// después de creadas. Limpieza real, ejecutada de forma perezosa en cada
// lectura del listado (no requiere infraestructura de cron adicional).
const NOTIFICATION_TTL_DAYS = 34;

async function cleanupExpiredNotifications(userId) {
  const cutoff = new Date(Date.now() - NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  // CORREGIR.xlsx ADMIN 14 — los mensajes manuales admin→cliente (kind
  // MANUAL) son un "correo interno" con historial permanente: nunca se
  // eliminan automáticamente, a diferencia de las notificaciones normales
  // del sistema (kind SYSTEM, comportamiento sin cambios).
  await prisma.notification.deleteMany({ where: { userId, kind: 'SYSTEM', createdAt: { lt: cutoff } } });
}

const listNotifications = asyncHandler(async (req, res) => {
  await cleanupExpiredNotifications(req.user.id);
  const notifications = await prisma.notification.findMany({
    // kind=MANUAL (mensajería interna admin↔cliente) tiene su propia sección
    // dedicada — nunca se mezcla con las notificaciones automáticas del
    // sistema, para que "Mensajes" y "Notificaciones" sean cosas claramente
    // distintas (igual para admin y cliente, mismo controlador).
    where: { userId: req.user.id, kind: 'SYSTEM' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    // El resultado técnico del envío de correo es solo para administración.
    omit: { emailError: true },
  });
  res.json({ ok: true, notifications });
});

const markAsRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

const markAllAsRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

// ELIMINACIÓN de notificaciones (una, varias o todas las seleccionadas).
// Siempre acotada al usuario autenticado (protección IDOR: los ids ajenos
// simplemente no coinciden) y solo a notificaciones del sistema — los
// mensajes manuales (kind MANUAL) tienen historial permanente propio.
const deleteNotificationsSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1, 'Selecciona al menos una notificación.').max(200),
});

const deleteNotifications = asyncHandler(async (req, res) => {
  const { ids } = deleteNotificationsSchema.parse(req.body);
  const { count } = await prisma.notification.deleteMany({
    where: { id: { in: ids }, userId: req.user.id, kind: 'SYSTEM' },
  });
  res.json({ ok: true, deleted: count });
});

module.exports = { listNotifications, markAsRead, markAllAsRead, deleteNotifications };
