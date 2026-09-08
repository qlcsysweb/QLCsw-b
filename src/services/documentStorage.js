/*
 * Almacenamiento de DOCUMENTOS (contratos, comprobantes, archivos de clientes)
 * en Google Drive. NeonDB guarda únicamente metadata + el Drive File ID.
 *
 * Estructura en Drive:
 *   <GOOGLE_DRIVE_FOLDER_ID> (raíz "QLC")
 *   └── Clientes/
 *       └── <Nombre Apellido (clientId)>/
 *           ├── Contratos/
 *           ├── Documentos/
 *           └── Pagos/
 *
 * Si las credenciales de Google Drive no están configuradas en .env, las
 * funciones lanzan un error explícito — no se simula una subida exitosa.
 */
const { Readable } = require('stream');
const { getDriveClient, isConfigured, resolveRootFolderId } = require('../config/googleDrive');
const prisma = require('../config/prisma');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function findOrCreateFolder(drive, name, parentId) {
  const escapedName = name.replace(/'/g, "\\'");
  const { data } = await drive.files.list({
    q: `name='${escapedName}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (data.files && data.files.length > 0) return data.files[0].id;

  const { data: created } = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id',
  });
  return created.id;
}

async function ensureClientFolders(client) {
  if (
    client.driveClientFolderId &&
    client.driveContractsFolderId &&
    client.driveDocumentsFolderId &&
    client.drivePaymentsFolderId
  ) {
    return {
      clientFolderId: client.driveClientFolderId,
      contractsFolderId: client.driveContractsFolderId,
      documentsFolderId: client.driveDocumentsFolderId,
      paymentsFolderId: client.drivePaymentsFolderId,
    };
  }

  const drive = getDriveClient();
  const rootId = await resolveRootFolderId();
  if (!rootId) {
    throw new Error(
      'No hay una carpeta raíz de Google Drive configurada. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
  const clientesFolderId = await findOrCreateFolder(drive, 'Clientes', rootId);
  const clientFolderId = await findOrCreateFolder(
    drive,
    `${client.firstName} ${client.lastName} (${client.id})`,
    clientesFolderId
  );
  const contractsFolderId = await findOrCreateFolder(drive, 'Contratos', clientFolderId);
  const documentsFolderId = await findOrCreateFolder(drive, 'Documentos', clientFolderId);
  const paymentsFolderId = await findOrCreateFolder(drive, 'Pagos', clientFolderId);

  await prisma.clientProfile.update({
    where: { id: client.id },
    data: {
      driveClientFolderId: clientFolderId,
      driveContractsFolderId: contractsFolderId,
      driveDocumentsFolderId: documentsFolderId,
      drivePaymentsFolderId: paymentsFolderId,
    },
  });

  return { clientFolderId, contractsFolderId, documentsFolderId, paymentsFolderId };
}

async function uploadDocument(buffer, { folderId, fileName, mimeType }) {
  const drive = getDriveClient();
  const { data } = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, mimeType, size',
  });
  return data;
}

async function deleteDocument(fileId) {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

async function downloadDocument(fileId) {
  const drive = getDriveClient();
  const { data: meta } = await drive.files.get({ fileId, fields: 'name, mimeType, size' });
  const { data: stream } = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return { stream, fileName: meta.name, mimeType: meta.mimeType };
}

module.exports = {
  isConfigured,
  ensureClientFolders,
  uploadDocument,
  deleteDocument,
  downloadDocument,
};
