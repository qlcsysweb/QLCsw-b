const path = require('path');
const driveStorage = require('../services/driveStorageService');
const prisma = require('../config/prisma');
const ApiError = require('./ApiError');
const { MAX_CASE_FILE_BYTES } = require('../middleware/upload');

// Nombre de archivo seguro para guardar/mostrar (sin rutas ni caracteres de
// control) — el binario real se identifica siempre por su driveFileId.
function safeFileName(name) {
  const base = path.basename(String(name || 'archivo')).replace(/[\u0000-\u001f<>:"/\|?*]+/g, '_').trim();
  return base.slice(0, 180) || 'archivo';
}

// Guarda un archivo de caso: revalida el tamaño en backend (aunque multer ya
// lo limita), lo sube a Drive (subcarpeta "Otros" del cliente) y registra la
// metadata. Nunca se guarda nada si Drive falla.
async function saveCaseFile({ supportCase, uploadedByUserId, file }) {
  if (!file) throw ApiError.badRequest('Debes adjuntar un archivo.');
  if (file.size > MAX_CASE_FILE_BYTES) throw ApiError.badRequest('El archivo supera el límite permitido de 5 MB.');
  if (file.size === 0) throw ApiError.badRequest('El archivo está vacío.');

  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con el almacenamiento de documentos. Contacta al equipo de QLC.');
  }

  const client = await prisma.clientProfile.findUnique({ where: { id: supportCase.clientId } });
  const folderId = await driveStorage.getOrCreateSubfolder(client, 'other');
  const fileName = safeFileName(file.originalname);
  const uploaded = await driveStorage.uploadFileToDrive(file.buffer, {
    folderId,
    fileName,
    mimeType: file.mimetype || 'application/octet-stream',
  });

  return prisma.supportCaseFile.create({
    data: {
      supportCaseId: supportCase.id,
      uploadedByUserId,
      fileName,
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
      driveFileId: uploaded.id,
      driveFolderId: folderId,
    },
  });
}

const CASE_FILE_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { role: true } },
};

async function streamCaseFile(res, fileRecord) {
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con el almacenamiento de documentos. Contacta al equipo de QLC.');
  }
  const { stream, mimeType } = await driveStorage.downloadFileFromDrive(fileRecord.driveFileId);
  res.setHeader('Content-Type', mimeType || fileRecord.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRecord.fileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
}

module.exports = { saveCaseFile, streamCaseFile, CASE_FILE_SELECT, safeFileName };
