const { google } = require('googleapis');
const prisma = require('./prisma');

let driveClient = null;

/*
 * Bootstrap (solo infraestructura, nunca editable desde el panel):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — la
 *   credencial técnica de la cuenta de servicio. Vive únicamente en .env,
 *   nunca se guarda en NeonDB ni se envía al frontend.
 *   GOOGLE_DRIVE_FOLDER_ID — valor de arranque; una vez que el administrador
 *   guarda una carpeta desde el panel, la fila en DriveConfiguration manda.
 *
 * Editable desde Admin → Configuración → Google Drive (tabla DriveConfiguration):
 *   carpeta raíz (rootFolderId / rootFolderName) y si la integración está
 *   habilitada (isEnabled). Nada de esto es secreto.
 */

function hasServiceAccountCreds() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

function serviceAccountEmail() {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;
}

async function getDriveConfigRow() {
  let row = await prisma.driveConfiguration.findFirst();
  if (!row) {
    row = await prisma.driveConfiguration.create({
      data: { rootFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null },
    });
  }
  return row;
}

async function resolveRootFolderId() {
  const row = await getDriveConfigRow();
  return row.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
}

async function isConfigured() {
  if (!hasServiceAccountCreds()) return false;
  const row = await getDriveConfigRow();
  if (!row.isEnabled) return false;
  const folderId = row.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
  return Boolean(folderId);
}

function getDriveClient() {
  if (!hasServiceAccountCreds()) {
    throw new Error(
      'Google Drive no está configurado. Falta la credencial técnica (GOOGLE_SERVICE_ACCOUNT_EMAIL / ' +
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) en el servidor.'
    );
  }
  if (driveClient) return driveClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // Los saltos de línea de la clave privada se guardan como "\n" literal en .env
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

module.exports = {
  getDriveClient,
  isConfigured,
  hasServiceAccountCreds,
  serviceAccountEmail,
  getDriveConfigRow,
  resolveRootFolderId,
};
