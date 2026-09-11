const prisma = require('../config/prisma');

/*
 * Crea una notificación real para el usuario dueño de un ClientProfile.
 * Se usa desde acciones administrativas (confirmar condición, activar
 * cliente, revisar pago, autorizar cita, etc.) para que el cliente vea
 * el cambio reflejado en su portal — nunca es un dato simulado.
 */
async function notifyClient(clientProfileId, { title, message, type = 'info', templateKey = null, templateParams = null }) {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientProfileId },
    select: { userId: true },
  });
  if (!client) return null;
  return prisma.notification.create({
    data: { userId: client.userId, title, message, type, templateKey, templateParams },
  });
}

/*
 * Crea una notificación real para TODOS los administradores activos —
 * mismo modelo Notification, reutilizado tal cual (ya usado para la
 * alerta de vencimiento de contrato). Se usa cuando el cliente reporta una
 * acción que requiere atención administrativa (ej. reportar una
 * transferencia/pago de garantía).
 */
async function notifyAdmins({ title, message, type = 'info', templateKey = null, templateParams = null }) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  return Promise.all(
    admins.map((admin) =>
      prisma.notification.create({
        data: { userId: admin.id, title, message, type, templateKey, templateParams },
      })
    )
  );
}

module.exports = { notifyClient, notifyAdmins };
