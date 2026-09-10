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

async function assertOwnsSubaccount(clientId, apiSubaccountId) {
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  return subaccount;
}

const getContract = asyncHandler(async (req, res) => {
  await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  const contract = await prisma.contract.findUnique({ where: { apiSubaccountId: req.params.apiSubaccountId } });
  res.json({ ok: true, contract });
});

const uploadSignedContract = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo');
  const subaccount = await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);

  const contract = await prisma.contract.findUnique({ where: { apiSubaccountId: subaccount.id } });
  if (!contract) throw ApiError.notFound('Todavía no existe un contrato para firmar');

  // Regla definitiva: una vez enviado, el cliente no puede reemplazarlo.
  // Solo el administrador puede liberar el bloqueo (eliminar el firmado).
  if (contract.signedDriveFileId) {
    throw ApiError.conflict(
      'Ya enviaste tu contrato firmado. Si necesitas reemplazarlo, contacta con QLC.'
    );
  }

  await assertDriveReady();
  const { contractsFolderId } = await documentStorage.ensureClientFolders(req.clientProfile);

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

const downloadContractFile = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const { variant } = req.params;
  if (!['original', 'signed'].includes(variant)) throw ApiError.badRequest('Variante no válida');

  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, contract.apiSubaccountId);

  const fileId = variant === 'original' ? contract.originalDriveFileId : contract.signedDriveFileId;
  if (!fileId) throw ApiError.notFound('El archivo solicitado no existe todavía');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(fileId);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = { getContract, uploadSignedContract, downloadContractFile };
