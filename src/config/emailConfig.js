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
    let decrypted;
    try {
      decrypted = decrypt(row.gmailAppPasswordEncrypted);
    } catch (err) {
      // ENCRYPTION_KEY distinta a la usada al guardar, dato corrupto, etc.
      // Nunca se deja caer como 500 genérico: se marca con un código propio
      // para que testConnection() lo traduzca en un mensaje específico.
      const decryptError = new Error('No se pudo descifrar la contraseña de aplicación guardada.');
      decryptError.code = 'EDECRYPT';
      throw decryptError;
    }
    return {
      user: row.gmailUser.trim(),
      senderName: row.gmailSenderName || 'Quantum Liquidity Capital (QLC)',
      appPassword: sanitizeAppPassword(decrypted),
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

// Solo comprueba PRESENCIA de credenciales (fila con datos, o variables de
// entorno definidas) — nunca intenta descifrar, para que un problema de
// descifrado no tumbe el estado general del panel con un 500. El descifrado
// real solo ocurre en resolveCredentials(), dentro de testConnection()/envío,
// donde un fallo sí se reporta con su causa exacta.
async function hasCredentials() {
  const row = await getEmailConfigRow();
  if (row.gmailUser && row.gmailAppPasswordEncrypted && row.isEnabled) return true;
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
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
