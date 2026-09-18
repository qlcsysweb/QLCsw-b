const prisma = require('./prisma');
const { decrypt } = require('../utils/crypto');

/*
 * AUDITORÍA QLC PARTE 13 — credenciales de Gmail resueltas igual que Google
 * Drive (config/googleDrive.js): preferimos lo guardado desde el panel
 * (Admin → Configuración → Correo, cifrado en EmailConfiguration), y si esa
 * fila no tiene credenciales propias caemos al bootstrap por variables de
 * entorno (GMAIL_USER / GMAIL_APP_PASSWORD). Así la integración ya existente
 * nunca se rompe mientras no haya credenciales configuradas en ningún lado.
 */

async function getEmailConfigRow() {
  let row = await prisma.emailConfiguration.findFirst();
  if (!row) {
    row = await prisma.emailConfiguration.create({
      data: { gmailUser: process.env.GMAIL_USER || null },
    });
  }
  return row;
}

// Google muestra la contraseña de aplicación con espacios visuales
// ("xxxx xxxx xxxx xxxx") pero la contraseña real no los lleva. Si se
// guarda o se lee con esos espacios, Gmail rechaza el login SMTP (535) aunque
// el resto de la configuración sea correcta. Se limpia siempre antes de
// autenticar, sin importar si el espacio quedó guardado por error en el
// pasado (fila existente) o viene de una variable de entorno con comillas.
function sanitizeAppPassword(value) {
  return (value || '').replace(/\s+/g, '');
}

async function resolveCredentials() {
  const row = await getEmailConfigRow();
  if (row.gmailUser && row.gmailAppPasswordEncrypted && row.isEnabled) {
    return {
      user: row.gmailUser.trim(),
      senderName: row.gmailSenderName || 'Quantum Liquidity Capital (QLC)',
      appPassword: sanitizeAppPassword(decrypt(row.gmailAppPasswordEncrypted)),
      source: 'db',
    };
  }
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return {
      user: process.env.GMAIL_USER.trim(),
      senderName: 'Quantum Liquidity Capital (QLC)',
      appPassword: sanitizeAppPassword(process.env.GMAIL_APP_PASSWORD),
      source: 'env',
    };
  }
  return null;
}

async function hasCredentials() {
  return Boolean(await resolveCredentials());
}

// Único punto donde se arma el transporte SMTP de Gmail, para que "Guardar"
// (a través de testConnection) y el envío real de notificaciones (emailService)
// nunca puedan divergir en host/puerto/seguridad.
function createGmailTransport(creds) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: creds.user, pass: creds.appPassword },
  });
}

module.exports = { getEmailConfigRow, resolveCredentials, hasCredentials, sanitizeAppPassword, createGmailTransport };
