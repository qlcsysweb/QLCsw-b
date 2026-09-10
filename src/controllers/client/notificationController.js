const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');

// CORRECCIÓN 25: las notificaciones se eliminan automáticamente 34 días
// después de creadas. Limpieza real, ejecutada de forma perezosa en cada
// lectura del listado (no requiere infraestructura de cron adicional).
const NOTIFICATION_TTL_DAYS = 34;

async function cleanupExpiredNotifications(userId) {
  const cutoff = new Date(Date.now() - NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.notification.deleteMany({ where: { userId, createdAt: { lt: cutoff } } });
}

const listNotifications = asyncHandler(async (req, res) => {
  await cleanupExpiredNotifications(req.user.id);
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
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

module.exports = { listNotifications, markAsRead, markAllAsRead };
