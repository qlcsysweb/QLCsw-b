const path = require('path');
const documentStorage = require('../../services/documentStorage');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

async function assertDriveReady() {
  if (!(await documentStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con el almacenamiento de documentos. Contacta al equipo de QLC.'
    );
  }
}

const listDocuments = asyncHandler(async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { clientId: req.clientProfile.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, documents });
});

const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo');
  const { category, description } = req.body;
  if (!category) throw ApiError.badRequest('La categoría es obligatoria');

  // Regla definitiva: una vez enviado un documento en una categoría, el
  // cliente no puede reemplazarlo. Solo el administrador puede eliminarlo
  // para liberar el bloqueo y permitir un nuevo envío. Se valida ANTES de
  // tocar Google Drive.
  const existing = await prisma.document.findFirst({
    where: { clientId: req.clientProfile.id, category, status: 'ACTIVE' },
  });
  if (existing) {
    throw ApiError.conflict(
      'Ya enviaste un documento en esta categoría. Si necesitas reemplazarlo, contacta con QLC.'
    );
  }

  await assertDriveReady();
  const { documentsFolderId } = await documentStorage.ensureClientFolders(req.clientProfile);

  const uploaded = await documentStorage.uploadDocument(req.file.buffer, {
    folderId: documentsFolderId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const document = await prisma.document.create({
    data: {
      clientId: req.clientProfile.id,
      category,
      description: description || null,
      driveFileId: uploaded.id,
      driveFolderId: documentsFolderId,
      fileName: req.file.originalname,
      extension: path.extname(req.file.originalname).replace('.', '') || null,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedByUserId: req.user.id,
    },
  });

  res.status(201).json({ ok: true, document });
});

const downloadDocument = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const document = await prisma.document.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(document.driveFileId);
  res.setHeader('Content-Type', mimeType || document.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || document.fileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// REVERSIÓN A: por defecto el documento queda BLOQUEADO en cuanto se
// envía — el cliente NO puede eliminarlo ni reemplazarlo. Solo cuando un
// ADMIN habilita explícitamente "clientEditUnlocked" en ESE documento
// puntual, el cliente puede eliminarlo (y así liberar la categoría para
// volver a subir uno nuevo, que nace bloqueado otra vez). Ownership
// verificado por clientId, nunca por el id del documento solo (evita que
// un cliente borre documentos de otro).
const deleteDocument = asyncHandler(async (req, res) => {
  const document = await prisma.document.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!document) throw ApiError.notFound('Documento no encontrado');
  if (!document.clientEditUnlocked) {
    throw ApiError.forbidden(
      'Este documento está bloqueado. Si necesitas reemplazarlo, contacta con QLC desde Soporte.'
    );
  }

  if (await documentStorage.isConfigured()) {
    await documentStorage.deleteDocument(document.driveFileId).catch(() => {});
  }
  await prisma.document.delete({ where: { id: document.id } });

  res.json({ ok: true });
});

module.exports = { listDocuments, uploadDocument, downloadDocument, deleteDocument };
