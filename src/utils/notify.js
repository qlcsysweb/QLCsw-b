const prisma = require('../config/prisma');
const { sendNotificationEmail, sendManualMessageEmail } = require('../services/emailService');
const { renderNotificationText } = require('./notificationI18n');

/*
 * AUDITORÍA QLC PARTE 12 — cada notificación interna intenta además enviar
 * un correo individual al usuario dueño de esa notificación (nunca en copia
 * a otros administradores o clientes). Es "best effort": si Gmail no está
 * configurado o el envío falla, la notificación interna YA quedó creada —
 * nunca se pierde ni bloquea el flujo que la disparó. `emailSent`/
 * `emailError` en el registro permiten comprobar después si el correo salió.
 */
// Devuelve la notificación con el resultado del correo ya registrado
// (emailSent/emailError) para que el admin sepa si salió o falló. El motivo
// se recorta — nunca se guarda un stack trace.
// AUDITORÍA MENSAJERÍA INTERNA — un mensaje MANUAL (buzón admin↔cliente)
// nunca envía su contenido real por correo: el correo es solo un aviso
// genérico ("tienes un nuevo mensaje, entra a tu panel"), nunca el asunto ni
// el cuerpo redactado por la otra persona. Las notificaciones SYSTEM (todo
// el resto: pagos, estados de cuenta, citas, etc.) siguen enviando su propio
// título/mensaje tal cual, sin cambios.
// IDIOMA — cada destinatario recibe el correo en el idioma que eligió en QLC
// (`language` = User.preferredLanguage; sin preferencia → español). La
// notificación interna no cambia: el panel ya la muestra en el idioma activo.
async function dispatchEmail(notification, email, attachments, language) {
  try {
    const result =
      notification.kind === 'MANUAL'
        ? await sendManualMessageEmail({ email, language })
        : await sendNotificationEmail({ email, language }, { ...renderNotificationText(notification, language), attachments });
    return await prisma.notification.update({
      where: { id: notification.id },
      data: result.sent
        ? { emailSent: true, emailSentAt: new Date(), emailError: null }
        : { emailError: String(result.reason || 'No se pudo enviar el correo.').slice(0, 300) },
    });
  } catch (err) {
    return prisma.notification
      .update({
        where: { id: notification.id },
        data: { emailError: String(err?.message || 'Error desconocido al enviar el correo.').replace(/\s+/g, ' ').slice(0, 300) },
      })
      .catch(() => notification);
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
 *
 * `attachments`: archivos adjuntos SOLO para el correo (formato nodemailer),
 * p. ej. el PDF del estado de cuenta. La notificación interna no los guarda:
 * el archivo queda disponible en el panel del cliente por su propia vía.
 */
async function notifyClient(
  clientProfileId,
  { title, message, type = 'info', templateKey = null, templateParams = null, skipEmail = false, attachments }
) {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientProfileId },
    select: { userId: true, user: { select: { email: true, isActive: true, preferredLanguage: true } } },
  });
  if (!client) return null;
  const notification = await prisma.notification.create({
    data: { userId: client.userId, title, message, type, templateKey, templateParams },
  });
  if (!skipEmail && client.user?.isActive && client.user.email) {
    return dispatchEmail(notification, client.user.email, attachments, client.user.preferredLanguage);
  }
  return notification;
}

/*
 * Crea una notificación real para TODOS los administradores activos —
 * mismo modelo Notification, reutilizado tal cual. Se usa cuando el cliente
 * reporta una acción que requiere atención administrativa. Cada admin
 * recibe su propio correo individual (nunca ve las direcciones de los demás).
 */
async function notifyAdmins({
  title,
  message,
  type = 'info',
  templateKey = null,
  templateParams = null,
  skipEmail = false,
  excludeUserId = null,
  kind,
  senderUserId,
}) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { id: true, email: true, preferredLanguage: true },
  });
  const notifications = await Promise.all(
    admins.map((admin) =>
      prisma.notification.create({
        data: {
          userId: admin.id,
          title,
          message,
          type,
          templateKey,
          templateParams,
          ...(kind ? { kind } : {}),
          ...(senderUserId ? { senderUserId } : {}),
        },
      })
    )
  );
  if (!skipEmail) {
    await Promise.all(notifications.map((n, i) => dispatchEmail(n, admins[i].email, undefined, admins[i].preferredLanguage)));
  }
  return notifications;
}

// Variante de bajo nivel para notificaciones que no parten de una acción
// admin→ClientProfile "genérica" (ej. mensajería manual de un caso, con
// kind/senderUserId propios) — mismo mecanismo de correo, sin duplicar lógica.
async function notifyUser(userId, { title, message, type = 'info', templateKey = null, templateParams = null, kind, senderUserId, skipEmail = false }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isActive: true, preferredLanguage: true } });
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
    return dispatchEmail(notification, user.email, undefined, user.preferredLanguage);
  }
  if (!skipEmail) {
    return prisma.notification
      .update({ where: { id: notification.id }, data: { emailError: 'El usuario no tiene un correo activo.' } })
      .catch(() => notification);
  }
  return notification;
}

/*
 * Aviso "Permisos de API" para un CLIENTE NUEVO — se crea una sola vez, en
 * la MISMA transacción que da de alta al usuario (registro por invitación o
 * alta manual por ADMIN): si la cuenta existe, el aviso existe. Idempotente
 * por templateKey + userId, así que un reintento nunca lo duplica, y como
 * solo se llama al crear la cuenta, iniciar sesión/recargar no genera otro
 * ni los clientes existentes lo reciben retroactivamente. Al abrirlo, el
 * frontend lleva a /client/guides?guide=permisos-api (notificationLinks.js).
 */
const API_PERMISSIONS_NOTICE_KEY = 'api_permissions_guide';

async function createApiPermissionsNotice(tx, userId) {
  const existing = await tx.notification.findFirst({
    where: { userId, templateKey: API_PERMISSIONS_NOTICE_KEY },
    select: { id: true },
  });
  if (existing) return null;
  return tx.notification.create({
    data: {
      userId,
      title: 'IMPORTANTE — Configura correctamente los permisos de tu API',
      message:
        'Antes de registrar o configurar tu API de Bitget, revisa la Guía de Uso — Permisos de API. Ahí encontrarás los permisos correspondientes a tu tipo de cuenta y las indicaciones sobre cuándo debes agregar una dirección IP.',
      type: 'warning',
      templateKey: API_PERMISSIONS_NOTICE_KEY,
      templateParams: { guide: 'permisos-api' },
    },
  });
}

// Correo "best effort" de una notificación ya creada (p. ej. dentro de una
// transacción) — mismo mecanismo que notifyClient, nunca bloquea el flujo.
async function emailExistingNotification(notification, email, language) {
  if (!notification || !email) return notification;
  return dispatchEmail(notification, email, undefined, language);
}

module.exports = { notifyClient, notifyAdmins, notifyUser, createApiPermissionsNotice, emailExistingNotification };
