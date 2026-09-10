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

// Contrato — 1:1 por SUBCUENTA/API (CORRECCIÓN 11/23).

const getContractBySubaccount = asyncHandler(async (req, res) => {
  const contract = await prisma.contract.findUnique({ where: { apiSubaccountId: req.params.apiSubaccountId } });
  res.json({ ok: true, contract });
});

// El administrador conserva la posibilidad de subir/reemplazar el
// contrato manualmente (p. ej. si el generado automáticamente al
// confirmar el modelo necesita un ajuste puntual).
const uploadOriginalContract = asyncHandler(async (req, res) => {
  await assertDriveReady();
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo');

  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: req.params.apiSubaccountId },
    include: { client: true },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const { contractsFolderId } = await documentStorage.ensureClientFolders(subaccount.client);

  const existing = await prisma.contract.findUnique({ where: { apiSubaccountId: subaccount.id } });
  if (existing?.originalDriveFileId) {
    await documentStorage.deleteDocument(existing.originalDriveFileId).catch(() => {});
  }

  const uploaded = await documentStorage.uploadDocument(req.file.buffer, {
    folderId: contractsFolderId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const data = {
    status: 'UPLOADED',
    originalDriveFileId: uploaded.id,
    originalDriveFolderId: contractsFolderId,
    originalFileName: req.file.originalname,
    originalMimeType: req.file.mimetype,
    originalSizeBytes: req.file.size,
    uploadedAt: new Date(),
  };

  const contract = existing
    ? await prisma.contract.update({ where: { id: existing.id }, data })
    : await prisma.contract.create({ data: { apiSubaccountId: subaccount.id, ...data } });

  await notifyClient(subaccount.clientId, {
    title: 'Contrato disponible',
    message: 'Tu contrato ya está disponible para revisión y firma.',
    type: 'info',
    templateKey: 'contract_available',
  });

  res.status(201).json({ ok: true, contract });
});

const uploadSignedContract = asyncHandler(async (req, res) => {
  await assertDriveReady();
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo');

  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: { apiSubaccount: { include: { client: true } } },
  });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');

  const { contractsFolderId } = await documentStorage.ensureClientFolders(contract.apiSubaccount.client);

  if (contract.signedDriveFileId) {
    await documentStorage.deleteDocument(contract.signedDriveFileId).catch(() => {});
  }

  const uploaded = await documentStorage.uploadDocument(req.file.buffer, {
    folderId: contractsFolderId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: {
      status: 'RECEIVED_SIGNED',
      signedDriveFileId: uploaded.id,
      signedDriveFolderId: contractsFolderId,
      signedFileName: req.file.originalname,
      signedMimeType: req.file.mimetype,
      signedSizeBytes: req.file.size,
      signedUploadedAt: new Date(),
    },
  });

  res.json({ ok: true, contract: updated });
});

const updateContractStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['PENDING', 'UPLOADED', 'RECEIVED_SIGNED', 'REJECTED'];
  if (!allowed.includes(status)) throw ApiError.badRequest('Estado no válido');

  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');

  const updated = await prisma.contract.update({ where: { id: contract.id }, data: { status } });

  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: contract.apiSubaccountId } });
  await notifyClient(subaccount.clientId, {
    title: 'Actualización de tu contrato',
    message: `Estado de tu contrato: ${status}`,
    type: status === 'REJECTED' ? 'warning' : 'info',
    templateKey: 'contract_status_updated',
    templateParams: { status },
  });

  res.json({ ok: true, contract: updated });
});

const downloadContractFile = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const { id, variant } = req.params;
  if (!['original', 'signed'].includes(variant)) throw ApiError.badRequest('Variante no válida');

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');

  const fileId = variant === 'original' ? contract.originalDriveFileId : contract.signedDriveFileId;
  if (!fileId) throw ApiError.notFound('El archivo solicitado no existe todavía');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(fileId);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// Libera el bloqueo del contrato firmado: elimina el archivo firmado (Drive +
// metadata) y el cliente vuelve a ver "pendiente de envío" para el firmado,
// sin perder el contrato original que el administrador ya subió.
const resetSignedContract = asyncHandler(async (req, res) => {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');
  if (!contract.signedDriveFileId) {
    throw ApiError.badRequest('Este contrato todavía no tiene un archivo firmado que eliminar.');
  }

  if (await documentStorage.isConfigured()) {
    await documentStorage.deleteDocument(contract.signedDriveFileId).catch(() => {});
  }

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: {
      status: contract.originalDriveFileId ? 'UPLOADED' : 'PENDING',
      signedDriveFileId: null,
      signedDriveFolderId: null,
      signedFileName: null,
      signedMimeType: null,
      signedSizeBytes: null,
      signedUploadedAt: null,
    },
  });

  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: contract.apiSubaccountId } });
  await notifyClient(subaccount.clientId, {
    title: 'Tu contrato firmado fue reiniciado',
    message: 'QLC eliminó tu archivo firmado. Puedes volver a subirlo cuando quieras.',
    type: 'info',
    templateKey: 'contract_signed_reset',
  });

  res.json({ ok: true, contract: updated });
});

const deleteContract = asyncHandler(async (req, res) => {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');

  if (await documentStorage.isConfigured()) {
    if (contract.originalDriveFileId) {
      await documentStorage.deleteDocument(contract.originalDriveFileId).catch(() => {});
    }
    if (contract.signedDriveFileId) {
      await documentStorage.deleteDocument(contract.signedDriveFileId).catch(() => {});
    }
  }

  await prisma.contract.delete({ where: { id: contract.id } });
  res.json({ ok: true });
});

module.exports = {
  getContractBySubaccount,
  uploadOriginalContract,
  uploadSignedContract,
  updateContractStatus,
  downloadContractFile,
  resetSignedContract,
  deleteContract,
};
