const prisma = require('../config/prisma');
const { sendNotificationEmail } = require('../services/emailService');

/*
 * AUDITORÍA QLC PARTE 12 — cada notificación interna intenta además enviar
 * un correo individual al usuario dueño de esa notificación (nunca en copia
 * a otros administradores o clientes). Es "best effort": si Gmail no está
 * configurado o el envío falla, la notificación interna YA quedó creada —
 * nunca se pierde ni bloquea el flujo que la disparó. `emailSent`/
 * `emailError` en el registro permiten comprobar después si el correo salió.
 */
async function dispatchEmail(notification, email) {
  try {
    const result = await sendNotificationEmail({ email }, { title: notification.title, message: notification.message });
    await prisma.notification.update({
      where: { id: notification.id },
      data: result.sent
        ? { emailSent: true, emailSentAt: new Date() }
        : { emailError: result.reason || 'No se pudo enviar el correo.' },
    });
  } catch (err) {
    await prisma.notification
      .update({ where: { id: notification.id }, data: { emailError: err?.message || 'Error desconocido al enviar el correo.' } })
      .catch(() => {});
  }
}

/*
 * Crea una notificación real para el usuario dueño de un ClientProfile.
 * Se usa desde acciones administrativas (confirmar condición, activar
 * cliente, revisar pago, autorizar cita, etc.) para que el cliente vea
 * el cambio reflejado en su portal — nunca es un dato simulado.
 *
 * `skipEmail`: solo para los pocos eventos que YA disparan un correo propio
 * y más detallado por su cuenta (ej. estado de cuenta generado) — evita
 * duplicar el envío para la misma acción.
 */
async function notifyClient(
  clientProfileId,
  { title, message, type = 'info', templateKey = null, templateParams = null, skipEmail = false }
) {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientProfileId },
    select: { userId: true, user: { select: { email: true, isActive: true } } },
  });
  if (!client) return null;
  const notification = await prisma.notification.create({
    data: { userId: client.userId, title, message, type, templateKey, templateParams },
  });
  if (!skipEmail && client.user?.isActive && client.user.email) {
    await dispatchEmail(notification, client.user.email);
  }
  return notification;
}

/*
 * Crea una notificación real para TODOS los administradores activos —
 * mismo modelo Notification, reutilizado tal cual. Se usa cuando el cliente
 * reporta una acción que requiere atención administrativa. Cada admin
 * recibe su propio correo individual (nunca ve las direcciones de los demás).
 */
async function notifyAdmins({ title, message, type = 'info', templateKey = null, templateParams = null, skipEmail = false }) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true, email: true } });
  const notifications = await Promise.all(
    admins.map((admin) =>
      prisma.notification.create({ data: { userId: admin.id, title, message, type, templateKey, templateParams } })
    )
  );
  if (!skipEmail) {
    await Promise.all(notifications.map((n, i) => dispatchEmail(n, admins[i].email)));
  }
  return notifications;
}

// Variante de bajo nivel para notificaciones que no parten de una acción
// admin→ClientProfile "genérica" (ej. mensajería manual de un caso, con
// kind/senderUserId propios) — mismo mecanismo de correo, sin duplicar lógica.
async function notifyUser(userId, { title, message, type = 'info', templateKey = null, templateParams = null, kind, senderUserId, skipEmail = false }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isActive: true } });
  const notification = await prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type,
      templateKey,
      templateParams,
      ...(kind ? { kind } : {}),
      ...(senderUserId ? { senderUserId } : {}),
    },
  });
  if (!skipEmail && user?.isActive && user.email) {
    await dispatchEmail(notification, user.email);
  }
  return notification;
}

module.exports = { notifyClient, notifyAdmins, notifyUser };
