const { z } = require('zod');
const documentStorage = require('../services/documentStorage');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

// CORREGIR.xlsx ADMIN 13 — alerta 10 días antes del vencimiento del
// contrato. Ejecutada de forma perezosa (mismo patrón que la limpieza de
// notificaciones/prospectos) cada vez que el admin abre la bandeja de
// contratos. expirationAlertSentAt evita generar alertas duplicadas para
// el mismo vencimiento.
const EXPIRATION_ALERT_DAYS = 10;

async function checkContractExpirations() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + EXPIRATION_ALERT_DAYS * 24 * 60 * 60 * 1000);

  const dueSoon = await prisma.contract.findMany({
    where: {
      expirationDate: { gte: now, lte: windowEnd },
      expirationAlertSentAt: null,
    },
    include: { apiSubaccount: { include: { client: { include: { user: { select: { id: true } } } } } } },
  });
  if (dueSoon.length === 0) return;

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });

  for (const contract of dueSoon) {
    const client = contract.apiSubaccount.client;
    const daysRemaining = Math.ceil((contract.expirationDate - now) / (24 * 60 * 60 * 1000));
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      admins.map((admin) =>
        prisma.notification.create({
          data: {
            userId: admin.id,
            title: 'Contrato próximo a vencer',
            message: `El contrato de ${client.firstName} ${client.lastName}${
              contract.apiSubaccount.identifier ? ` (${contract.apiSubaccount.identifier})` : ''
            } vence el ${contract.expirationDate.toISOString().slice(0, 10)} (${daysRemaining} día(s) restantes).`,
            type: 'warning',
            templateKey: 'contract_expiration_alert',
            templateParams: {
              clientName: `${client.firstName} ${client.lastName}`,
              identifier: contract.apiSubaccount.identifier,
              expirationDate: contract.expirationDate.toISOString().slice(0, 10),
              daysRemaining: String(daysRemaining),
            },
          },
        })
      )
    );
    // eslint-disable-next-line no-await-in-loop
    await prisma.contract.update({ where: { id: contract.id }, data: { expirationAlertSentAt: new Date() } });
  }
}

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

// CORREGIR.xlsx ADMIN 11/12 — bandeja de entrada + organización tipo Drive
// (Año → Mes) de TODOS los contratos, para identificar cuáles llegaron
// firmados, revisarlos/descargarlos y saber cliente/subcuenta/periodo de
// recepción. Nunca mezcla contratos entre subcuentas (Contract es 1:1 por
// ApiSubaccount desde su diseño original).
const listAllContracts = asyncHandler(async (req, res) => {
  await checkContractExpirations();

  const { status, reviewed, clientId } = req.query;
  const contracts = await prisma.contract.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(reviewed === 'true' ? { reviewedAt: { not: null } } : {}),
      ...(reviewed === 'false' ? { reviewedAt: null } : {}),
      ...(clientId ? { apiSubaccount: { clientId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      apiSubaccount: {
        select: {
          identifier: true,
          slotIndex: true,
          isPrincipal: true,
          client: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  res.json({ ok: true, contracts });
});

const markContractReviewed = asyncHandler(async (req, res) => {
  const reviewed = req.body?.reviewed !== false;
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: reviewed
      ? { reviewedAt: new Date(), reviewedByUserId: req.user.id }
      : { reviewedAt: null, reviewedByUserId: null },
  });
  res.json({ ok: true, contract: updated });
});

// CORREGIR.xlsx ADMIN 13 — vigencia del contrato (inicio/vencimiento).
const setContractVigenciaSchema = z.object({
  startDate: z.coerce.date().nullable().optional(),
  expirationDate: z.coerce.date().nullable().optional(),
});

const setContractVigencia = asyncHandler(async (req, res) => {
  const { startDate, expirationDate } = setContractVigenciaSchema.parse(req.body);
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) throw ApiError.notFound('Contrato no encontrado');

  const expirationChanged =
    expirationDate !== undefined && expirationDate?.getTime() !== contract.expirationDate?.getTime();

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: {
      ...(startDate !== undefined ? { startDate } : {}),
      ...(expirationDate !== undefined ? { expirationDate } : {}),
      // Si cambia la fecha de vencimiento, se limpia la marca de alerta
      // enviada para que el aviso de 10 días vuelva a evaluarse contra la
      // nueva fecha (nunca deja de avisar por una vigencia renovada).
      ...(expirationChanged ? { expirationAlertSentAt: null } : {}),
    },
  });
  res.json({ ok: true, contract: updated });
});

module.exports = {
  getContractBySubaccount,
  uploadOriginalContract,
  uploadSignedContract,
  updateContractStatus,
  downloadContractFile,
  resetSignedContract,
  deleteContract,
  listAllContracts,
  markContractReviewed,
  setContractVigencia,
};
