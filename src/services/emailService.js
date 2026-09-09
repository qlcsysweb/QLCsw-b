/*
 * Envío de correo vía Gmail (SMTP con contraseña de aplicación).
 * Si GMAIL_USER / GMAIL_APP_PASSWORD no están configurados en .env,
 * la función retorna { sent: false } sin lanzar error, para no bloquear
 * el registro de prospectos mientras no existan credenciales reales.
 *
 * Alcance §1: el correo debe incluir el PDF informativo (si el admin ya lo
 * configuró en Configuración → Plataforma) junto con un mensaje de
 * bienvenida — en el idioma que el prospecto tenía seleccionado al enviar
 * el formulario (cookie de idioma, nunca un idioma inventado por el backend).
 */
const prisma = require('../config/prisma');
const documentStorage = require('./documentStorage');

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
    bodyWithPdf: (name) =>
      `Hola ${name}, hemos recibido tu solicitud de información sobre QLC. Adjuntamos información adicional sobre nuestra propuesta. Un miembro de nuestro equipo se pondrá en contacto contigo próximamente.`,
  },
  en: {
    subject: 'Quantum Liquidity Capital — Information received',
    body: (name) =>
      `Hi ${name}, we've received your request for information about QLC. A member of our team will contact you shortly.`,
    bodyWithPdf: (name) =>
      `Hi ${name}, we've received your request for information about QLC. We've attached additional information about our offering. A member of our team will contact you shortly.`,
  },
};

async function buildInfoPdfAttachment() {
  try {
    const settings = await prisma.platformSettings.findFirst();
    if (!settings?.infoPdfDriveFileId) return null;
    if (!(await documentStorage.isConfigured())) return null;

    const { stream, fileName, mimeType } = await documentStorage.downloadDocument(settings.infoPdfDriveFileId);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    return {
      filename: settings.infoPdfFileName || fileName || 'QLC-informacion.pdf',
      content: Buffer.concat(chunks),
      contentType: mimeType || settings.infoPdfMimeType || 'application/pdf',
    };
  } catch {
    // Si el PDF no se puede recuperar, el correo de bienvenida igual se
    // envía sin adjunto — nunca bloquea el registro del prospecto.
    return null;
  }
}

async function sendProspectWelcomeEmail(prospect, language) {
  const transport = getTransport();
  if (!transport) {
    return { sent: false, reason: 'Credenciales de Gmail no configuradas en .env' };
  }

  const lang = language === 'en' ? 'en' : 'es';
  const copy = COPY[lang];
  const attachment = await buildInfoPdfAttachment();

  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: prospect.email,
    subject: copy.subject,
    text: attachment ? copy.bodyWithPdf(prospect.firstName) : copy.body(prospect.firstName),
    attachments: attachment ? [attachment] : [],
  });

  return { sent: true, attachedPdf: Boolean(attachment) };
}

module.exports = { sendProspectWelcomeEmail };
