/*
 * Envío de correo vía Gmail (SMTP con contraseña de aplicación).
 * Si GMAIL_USER / GMAIL_APP_PASSWORD no están configurados en .env,
 * la función retorna { sent: false } sin lanzar error, para no bloquear
 * el registro de prospectos mientras no existan credenciales reales.
 *
 * El correo de bienvenida es texto simple, en el idioma que el prospecto
 * tenía seleccionado al enviar el formulario (cookie de idioma, nunca un
 * idioma inventado por el backend). NO adjunta ningún PDF — el "PDF
 * informativo" automático fue retirado del alcance del sistema.
 */

let nodemailerTransport = null;

function getTransport() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  if (nodemailerTransport) return nodemailerTransport;

  const nodemailer = require('nodemailer');
  nodemailerTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return nodemailerTransport;
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
  const transport = getTransport();
  if (!transport) {
    return { sent: false, reason: 'Credenciales de Gmail no configuradas en .env' };
  }

  const lang = language === 'en' ? 'en' : 'es';
  const copy = COPY[lang];

  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: prospect.email,
    subject: copy.subject,
    text: copy.body(prospect.firstName),
  });

  return { sent: true };
}

module.exports = { sendProspectWelcomeEmail };
