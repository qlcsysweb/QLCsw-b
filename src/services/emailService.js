/*
 * Envío de correo real (notificaciones, bienvenida, estados de cuenta).
 * Las credenciales y el mecanismo de transporte (SMTP con contraseña de
 * aplicación, o Gmail API vía OAuth2) se resuelven en config/emailConfig.js
 * — este archivo nunca decide cuál usar, solo arma el asunto/cuerpo y llama
 * a `sendMailUnified`, el mismo punto de envío que usa "Enviar correo de
 * prueba" del panel. Así ambos caminos nunca pueden divergir.
 *
 * Si no hay credenciales configuradas, las funciones retornan
 * { sent: false } sin lanzar error, para no bloquear ningún flujo del
 * sistema mientras el correo no esté configurado.
 *
 * AUDITORÍA QLC PARTE 12/13 — además de los correos específicos ya
 * existentes (bienvenida a prospecto, estado de cuenta generado), se agrega
 * `sendNotificationEmail`: un envío genérico que reutiliza el título/mensaje
 * ya redactado de cada Notification interna, para que TODA notificación del
 * sistema (admin o cliente) también llegue por correo sin tener que
 * redactar un texto nuevo para cada uno de los ~20 tipos de evento.
 */
const { resolveCredentials, sendMailUnified } = require('../config/emailConfig');

const COPY = {
  es: {
    subject: 'Quantum Liquidity Capital — Información recibida',
    body: (name) =>
      `Hola ${name}, hemos recibido tu solicitud de información sobre QLC. Un miembro de nuestro equipo se pondrá en contacto contigo próximamente.`,
  },
  en: {
    subject: 'Quantum Liquidity Capital — Information received',
    body: (name) =>
      `Hi ${name}, we've received your request for information about QLC. A member of our team will contact you shortly.`,
  },
};

async function sendProspectWelcomeEmail(prospect, language) {
  const creds = await resolveCredentials();
  if (!creds) return { sent: false, reason: 'Credenciales de Gmail no configuradas' };

  const lang = language === 'en' ? 'en' : 'es';
  const copy = COPY[lang];

  await sendMailUnified(creds, { to: prospect.email, subject: copy.subject, text: copy.body(prospect.firstName) });
  return { sent: true };
}

// CORREGIR(2).xlsx CLIENTE 15 — cuando se genera un estado de cuenta con
// comisión pendiente de pago, además de la notificación interna, se envía
// un correo al cliente con el asunto EXACTO solicitado. No se inventan
// datos bancarios: el correo solo informa, el pago sigue siendo el flujo de
// USDT ya definido por QLC (reportar transferencia → admin confirma).
async function sendStatementGeneratedEmail(user, { identifier, commissionDueHours }) {
  const creds = await resolveCredentials();
  if (!creds) return { sent: false, reason: 'Credenciales de Gmail no configuradas' };

  const subject = 'Estado de cuenta QLC generado y pendiente de pago';
  const text = `Se generó un nuevo estado de cuenta${identifier ? ` para tu subcuenta/API ${identifier}` : ''} y quedó pendiente de pago. Dispones de ${commissionDueHours} horas para reportar el pago correspondiente desde tu panel de QLC (sección Pagos). Ingresa a tu panel para ver el detalle completo y reportar tu transferencia en USDT.`;

  await sendMailUnified(creds, { to: user.email, subject, text });
  return { sent: true };
}

// AUDITORÍA QLC PARTE 12 — correo genérico para cualquier Notification
// interna (SYSTEM o MANUAL), enviada individualmente a un solo destinatario
// (nunca en copia/CC a otros administradores o clientes). El asunto y
// cuerpo son el título/mensaje que YA se le muestra al usuario dentro de la
// plataforma — nunca se inventa contenido adicional.
async function sendNotificationEmail(user, { title, message }) {
  if (!user?.email) return { sent: false, reason: 'El usuario no tiene correo registrado' };
  const creds = await resolveCredentials();
  if (!creds) return { sent: false, reason: 'Credenciales de Gmail no configuradas' };

  await sendMailUnified(creds, {
    to: user.email,
    subject: `QLC — ${title}`,
    text: `${message}\n\n— Quantum Liquidity Capital (QLC)\nEste es un aviso automático, generado también como notificación dentro de tu panel de QLC.`,
  });
  return { sent: true };
}

module.exports = { sendProspectWelcomeEmail, sendStatementGeneratedEmail, sendNotificationEmail };
