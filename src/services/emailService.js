/*
 * Envío de correo real (notificaciones — incluida la mensajería interna — y bienvenida).
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
 * AUDITORÍA QLC PARTE 12/13 — además del correo de bienvenida a prospecto,
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

// MENSAJERÍA INTERNA (buzón admin↔cliente) — el correo NUNCA lleva el
// asunto ni el contenido real del mensaje (podría ser información sensible
// redactada por la otra persona): es solo un aviso genérico que empuja al
// destinatario a entrar a su panel de QLC para leer y responder ahí.
async function sendManualMessageEmail(user) {
  if (!user?.email) return { sent: false, reason: 'El usuario no tiene correo registrado' };
  const creds = await resolveCredentials();
  if (!creds) return { sent: false, reason: 'Credenciales de Gmail no configuradas' };

  await sendMailUnified(creds, {
    to: user.email,
    subject: 'QLC — Tienes un nuevo mensaje',
    text: 'Tienes un nuevo mensaje dentro de QLC.\n\nIngresa a tu panel para consultarlo y responder.\n\n— Quantum Liquidity Capital (QLC)',
  });
  return { sent: true };
}

module.exports = { sendProspectWelcomeEmail, sendNotificationEmail, sendManualMessageEmail };
