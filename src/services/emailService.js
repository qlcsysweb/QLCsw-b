/*
 * Envío de correo vía Gmail (SMTP con contraseña de aplicación).
 * Las credenciales se resuelven vía config/emailConfig.js: primero lo
 * guardado desde el panel (Admin → Configuración → Correo), luego el
 * bootstrap por variables de entorno (GMAIL_USER / GMAIL_APP_PASSWORD). Si
 * ninguna existe, las funciones retornan { sent: false } sin lanzar error,
 * para no bloquear ningún flujo mientras no existan credenciales reales.
 *
 * AUDITORÍA QLC PARTE 12/13 — además de los correos específicos ya
 * existentes (bienvenida a prospecto, estado de cuenta generado), se agrega
 * `sendNotificationEmail`: un envío genérico que reutiliza el título/mensaje
 * ya redactado de cada Notification interna, para que TODA notificación del
 * sistema (admin o cliente) también llegue por correo sin tener que
 * redactar un texto nuevo para cada uno de los ~20 tipos de evento.
 */
const { resolveCredentials, createGmailTransport } = require('../config/emailConfig');

let cachedTransport = null;
let cachedSignature = null;

async function getTransport() {
  const creds = await resolveCredentials();
  if (!creds) return null;

  const signature = `${creds.user}:${creds.appPassword}`;
  if (cachedTransport && cachedSignature === signature) return { transport: cachedTransport, from: `"${creds.senderName}" <${creds.user}>` };

  // Mismo constructor de transporte que usa "Enviar correo de prueba"
  // (config/emailConfig.js) — Guardar/Probar y el envío real de
  // notificaciones nunca pueden quedar con configuraciones SMTP distintas.
  cachedTransport = createGmailTransport(creds);
  cachedSignature = signature;
  return { transport: cachedTransport, from: `"${creds.senderName}" <${creds.user}>` };
}

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
  const ready = await getTransport();
  if (!ready) return { sent: false, reason: 'Credenciales de Gmail no configuradas' };

  const lang = language === 'en' ? 'en' : 'es';
  const copy = COPY[lang];

  await ready.transport.sendMail({
    from: ready.from,
    to: prospect.email,
    subject: copy.subject,
    text: copy.body(prospect.firstName),
  });

  return { sent: true };
}

// CORREGIR(2).xlsx CLIENTE 15 — cuando se genera un estado de cuenta con
// comisión pendiente de pago, además de la notificación interna, se envía
// un correo al cliente con el asunto EXACTO solicitado. No se inventan
// datos bancarios: el correo solo informa, el pago sigue siendo el flujo de
// USDT ya definido por QLC (reportar transferencia → admin confirma).
async function sendStatementGeneratedEmail(user, { identifier, commissionDueHours }) {
  const ready = await getTransport();
  if (!ready) return { sent: false, reason: 'Credenciales de Gmail no configuradas' };

  const subject = 'Estado de cuenta QLC generado y pendiente de pago';
  const text = `Se generó un nuevo estado de cuenta${identifier ? ` para tu subcuenta/API ${identifier}` : ''} y quedó pendiente de pago. Dispones de ${commissionDueHours} horas para reportar el pago correspondiente desde tu panel de QLC (sección Pagos). Ingresa a tu panel para ver el detalle completo y reportar tu transferencia en USDT.`;

  await ready.transport.sendMail({ from: ready.from, to: user.email, subject, text });
  return { sent: true };
}

// AUDITORÍA QLC PARTE 12 — correo genérico para cualquier Notification
// interna (SYSTEM o MANUAL), enviada individualmente a un solo destinatario
// (nunca en copia/CC a otros administradores o clientes). El asunto y
// cuerpo son el título/mensaje que YA se le muestra al usuario dentro de la
// plataforma — nunca se inventa contenido adicional.
async function sendNotificationEmail(user, { title, message }) {
  if (!user?.email) return { sent: false, reason: 'El usuario no tiene correo registrado' };
  const ready = await getTransport();
  if (!ready) return { sent: false, reason: 'Credenciales de Gmail no configuradas' };

  await ready.transport.sendMail({
    from: ready.from,
    to: user.email,
    subject: `QLC — ${title}`,
    text: `${message}\n\n— Quantum Liquidity Capital (QLC)\nEste es un aviso automático, generado también como notificación dentro de tu panel de QLC.`,
  });
  return { sent: true };
}

module.exports = { sendProspectWelcomeEmail, sendStatementGeneratedEmail, sendNotificationEmail };
