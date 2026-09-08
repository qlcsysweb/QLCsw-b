/*
 * Envío de correo vía Gmail (SMTP con contraseña de aplicación).
 * Si GMAIL_USER / GMAIL_APP_PASSWORD no están configurados en .env,
 * la función retorna { sent: false } sin lanzar error, para no bloquear
 * el registro de prospectos mientras no existan credenciales reales.
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

async function sendProspectWelcomeEmail(prospect) {
  const transport = getTransport();
  if (!transport) {
    return { sent: false, reason: 'Credenciales de Gmail no configuradas en .env' };
  }

  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: prospect.email,
    subject: 'Quantum Liquidity Capital — Información recibida',
    text: `Hola ${prospect.firstName}, hemos recibido tu solicitud de información sobre QLC. Un miembro de nuestro equipo se pondrá en contacto contigo próximamente.`,
  });

  return { sent: true };
}

module.exports = { sendProspectWelcomeEmail };
