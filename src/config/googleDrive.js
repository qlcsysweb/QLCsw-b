const { google } = require('googleapis');
const prisma = require('./prisma');
const { decrypt } = require('../utils/crypto');

let driveClient = null;
let driveClientKeySignature = null;

/*
 * CORRECCIÓN 7 — la credencial técnica de la cuenta de servicio ahora puede
 * configurarse desde Admin → Configuración → Google Drive (guardada
 * cifrada en DriveConfiguration.serviceAccountPrivateKeyEncrypted). El
 * bootstrap por variables de entorno sigue funcionando como respaldo
 * mientras esa fila no tenga sus propias credenciales — así la integración
 * ya existente nunca se rompe.
 *
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — .env
 *   GOOGLE_DRIVE_FOLDER_ID — valor de arranque; una vez que el administrador
 *   guarda una carpeta desde el panel, la fila en DriveConfiguration manda.
 */

async function getDriveConfigRow() {
  let row = await prisma.driveConfiguration.findFirst();
  if (!row) {
    row = await prisma.driveConfiguration.create({
      data: { rootFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null },
    });
  }
  return row;
}

// Resuelve las credenciales activas: preferimos las guardadas en BD por un
// admin autorizado; si no existen, caemos al bootstrap de .env.
async function resolveCredentials() {
  const row = await getDriveConfigRow();
  if (row.serviceAccountEmail && row.serviceAccountPrivateKeyEncrypted) {
    return {
      email: row.serviceAccountEmail,
      privateKey: decrypt(row.serviceAccountPrivateKeyEncrypted),
      source: 'db',
    };
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      source: 'env',
    };
  }
  return null;
}

async function hasServiceAccountCreds() {
  return Boolean(await resolveCredentials());
}

async function serviceAccountEmail() {
  const creds = await resolveCredentials();
  return creds?.email || null;
}

async function resolveRootFolderId() {
  const row = await getDriveConfigRow();
  return row.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
}

async function isConfigured() {
  const creds = await resolveCredentials();
  if (!creds) return false;
  const row = await getDriveConfigRow();
  if (!row.isEnabled) return false;
  const folderId = row.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
  return Boolean(folderId);
}

async function getDriveClient() {
  const creds = await resolveCredentials();
  if (!creds) {
    throw new Error(
      'Google Drive no está configurado. Configura la cuenta de servicio desde Admin → Configuración → Google Drive, ' +
        'o define GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY en el servidor.'
    );
  }
  // Invalida el cliente cacheado si cambian las credenciales activas (p.ej.
  // un admin acaba de guardar una configuración nueva desde el panel).
  const signature = `${creds.source}:${creds.email}`;
  if (driveClient && driveClientKeySignature === signature) return driveClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.email,
      private_key: creds.privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  driveClient = google.drive({ version: 'v3', auth });
  driveClientKeySignature = signature;
  return driveClient;
}

module.exports = {
  getDriveClient,
  isConfigured,
  hasServiceAccountCreds,
  serviceAccountEmail,
  getDriveConfigRow,
  resolveRootFolderId,
  resolveCredentials,
};
