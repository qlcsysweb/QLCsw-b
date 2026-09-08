const path = require('path');
const documentStorage = require('../services/documentStorage');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

async function assertDriveReady() {
  if (!(await documentStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con Google Drive. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
}

const listDocumentsByClient = asyncHandler(async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { clientId: req.params.clientId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, documents });
});

const uploadDocument = asyncHandler(async (req, res) => {
  await assertDriveReady();
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo');
  const { category, description } = req.body;
  if (!category) throw ApiError.badRequest('La categoría es obligatoria');

  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const { documentsFolderId } = await documentStorage.ensureClientFolders(client);

  const uploaded = await documentStorage.uploadDocument(req.file.buffer, {
    folderId: documentsFolderId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const document = await prisma.document.create({
    data: {
      clientId: client.id,
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
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(document.driveFileId);
  res.setHeader('Content-Type', mimeType || document.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || document.fileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

const deleteDocument = asyncHandler(async (req, res) => {
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  if (await documentStorage.isConfigured()) {
    await documentStorage.deleteDocument(document.driveFileId).catch(() => {});
  }
  await prisma.document.delete({ where: { id: document.id } });

  await notifyClient(document.clientId, {
    title: 'Puedes volver a enviar tu documento',
    message: `QLC eliminó tu documento de "${document.category}". Ya puedes subir uno nuevo.`,
    type: 'info',
  });

  res.json({ ok: true });
});

module.exports = { listDocumentsByClient, uploadDocument, downloadDocument, deleteDocument };
