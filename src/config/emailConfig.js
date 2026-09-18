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

async function resolveCredentials() {
  const row = await getEmailConfigRow();
  if (row.gmailUser && row.gmailAppPasswordEncrypted && row.isEnabled) {
    return {
      user: row.gmailUser,
      senderName: row.gmailSenderName || 'Quantum Liquidity Capital (QLC)',
      appPassword: decrypt(row.gmailAppPasswordEncrypted),
      source: 'db',
    };
  }
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return {
      user: process.env.GMAIL_USER,
      senderName: 'Quantum Liquidity Capital (QLC)',
      appPassword: process.env.GMAIL_APP_PASSWORD,
      source: 'env',
    };
  }
  return null;
}

async function hasCredentials() {
  return Boolean(await resolveCredentials());
}

module.exports = { getEmailConfigRow, resolveCredentials, hasCredentials };
