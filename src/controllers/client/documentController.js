const path = require('path');
const driveStorage = require('../../services/driveStorageService');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyClient, notifyAdmins } = require('../../utils/notify');

async function assertDriveReady() {
  if (!(await driveStorage.isConfigured())) {
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
  const { documentsFolderId } = await driveStorage.ensureClientFolders(req.clientProfile);

  const uploaded = await driveStorage.uploadFileToDrive(req.file.buffer, {
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

  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  await notifyClient(req.clientProfile.id, {
    title: 'Documento entregado',
    message: `Recibimos tu documento de la categoría "${category}".`,
    type: 'success',
    templateKey: 'document_submitted',
    templateParams: { category },
  });
  await notifyAdmins({
    title: 'Documento subido por un cliente',
    message: `${client.firstName} ${client.lastName} subió un documento de la categoría "${category}".`,
    type: 'info',
    templateKey: 'document_submitted_admin',
    templateParams: { clientName: `${client.firstName} ${client.lastName}`, category, clientId: req.clientProfile.id },
  });

  res.status(201).json({ ok: true, document });
});

const downloadDocument = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const document = await prisma.document.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(document.driveFileId);
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

  if (await driveStorage.isConfigured()) {
    // Ownership ya verificado arriba (clientId: req.clientProfile.id).
    await driveStorage.deleteDriveFileOnlyWhenAuthorized(document.driveFileId, { authorized: true }).catch(() => {});
  }
  await prisma.document.delete({ where: { id: document.id } });

  res.json({ ok: true });
});

// "Enviar archivo corregido" — reemplaza en un solo paso atómico el archivo
// de un documento YA enviado, pero SOLO si un admin lo habilitó explícitamente
// (clientEditUnlocked=true en ESE documento puntual; nunca se confía en nada
// que venga de React). A diferencia de deleteDocument + uploadDocument por
// separado, aquí el archivo VIEJO en Drive no se borra hasta que el nuevo ya
// se subió correctamente y NeonDB ya refleja el cambio — si algo falla antes
// de eso, el documento original sigue intacto y nada se pierde.
const correctDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar el archivo corregido');

  const document = await prisma.document.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!document) throw ApiError.notFound('Documento no encontrado');
  if (!document.clientEditUnlocked) {
    throw ApiError.forbidden(
      'Este documento no tiene una corrección habilitada. Contacta con QLC desde Soporte si necesitas reemplazarlo.'
    );
  }

  await assertDriveReady();
  const { documentsFolderId } = await driveStorage.ensureClientFolders(req.clientProfile);

  const uploaded = await driveStorage.uploadFileToDrive(req.file.buffer, {
    folderId: documentsFolderId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const previous = {
    fileName: document.fileName,
    driveFileId: document.driveFileId,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
  };

  const updated = await prisma.$transaction(async (tx) => {
    await tx.documentCorrection.create({
      data: {
        documentId: document.id,
        previousFileName: previous.fileName,
        previousDriveFileId: previous.driveFileId,
        previousMimeType: previous.mimeType,
        previousSizeBytes: previous.sizeBytes,
        correctedByUserId: req.user.id,
      },
    });

    return tx.document.update({
      where: { id: document.id },
      data: {
        driveFileId: uploaded.id,
        driveFolderId: documentsFolderId,
        fileName: req.file.originalname,
        extension: path.extname(req.file.originalname).replace('.', '') || null,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedByUserId: req.user.id,
        // Se bloquea de nuevo automáticamente y se apaga la corrección: el
        // admin debe volver a habilitarla si hiciera falta otra corrección.
        clientEditUnlocked: false,
        unlockedByUserId: null,
        unlockedAt: null,
      },
    });
  });

  // Solo ahora, con el archivo nuevo ya confirmado en Drive y en NeonDB, se
  // borra el archivo anterior — nunca antes.
  await driveStorage.deleteDriveFileOnlyWhenAuthorized(previous.driveFileId, { authorized: true }).catch(() => {});

  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  await notifyAdmins({
    title: 'Documento corregido recibido',
    message: `${client.firstName} ${client.lastName} envió una corrección de su documento de la categoría "${document.category}".`,
    type: 'info',
    templateKey: 'document_corrected_admin',
    templateParams: { clientName: `${client.firstName} ${client.lastName}`, category: document.category, clientId: req.clientProfile.id },
  });

  res.json({ ok: true, document: updated });
});

module.exports = { listDocuments, uploadDocument, downloadDocument, deleteDocument, correctDocument };
