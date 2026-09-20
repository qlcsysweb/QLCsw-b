const { z } = require('zod');
const driveStorage = require('../services/driveStorageService');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

async function assertDriveReady() {
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con Google Drive. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
}

const getPaymentConfig = asyncHandler(async (req, res) => {
  const config = await prisma.paymentConfiguration.findFirst();
  res.json({ ok: true, config });
});

const updatePaymentConfigSchema = z.object({
  network: z.string().optional(),
  walletAddress: z.string().optional(),
  paymentLink: z.string().optional(),
  instructions: z.string().optional(),
  // "currency" se acepta si viene en el body (para no romper un cliente que
  // reenvíe el objeto completo) pero SIEMPRE se ignora — ver más abajo.
  currency: z.string().optional(),
});

const updatePaymentConfig = asyncHandler(async (req, res) => {
  const data = updatePaymentConfigSchema.parse(req.body);
  let config = await prisma.paymentConfiguration.findFirst();
  if (!config) config = await prisma.paymentConfiguration.create({ data: {} });

  // La moneda de QLC es fija: USDT. Nunca se acepta un valor distinto,
  // sin importar lo que envíe el frontend — se fuerza siempre en backend.
  const updated = await prisma.paymentConfiguration.update({
    where: { id: config.id },
    data: {
      network: data.network,
      walletAddress: data.walletAddress,
      paymentLink: data.paymentLink,
      instructions: data.instructions,
      currency: 'USDT',
    },
  });
  res.json({ ok: true, config: updated });
});

// IMPLEMENTACIÓN DEFINITIVA DE GOOGLE DRIVE — el QR de pago es un archivo
// OPERATIVO (usado para que los clientes transfieran USDT), no un recurso
// visual del sitio: se sube a Drive, nunca a Cloudinary. Los campos legado
// qrUrl/qrPublicId (Cloudinary) se CONSERVAN sin tocar si ya existían de
// antes — no se borran ni se migran automáticamente.
const uploadPaymentQr = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar una imagen');
  await assertDriveReady();

  let config = await prisma.paymentConfiguration.findFirst();
  if (!config) config = await prisma.paymentConfiguration.create({ data: {} });

  if (config.qrDriveFileId) {
    await driveStorage.deleteDriveFileOnlyWhenAuthorized(config.qrDriveFileId, { authorized: true }).catch(() => {});
  }

  const qrFolderId = await driveStorage.ensurePlatformQrFolder();
  const uploaded = await driveStorage.uploadFileToDrive(req.file.buffer, {
    folderId: qrFolderId,
    fileName: req.file.originalname || 'qr-pago.png',
    mimeType: req.file.mimetype,
  });

  const updated = await prisma.paymentConfiguration.update({
    where: { id: config.id },
    data: { qrDriveFileId: uploaded.id, qrDriveFolderId: qrFolderId },
  });

  res.json({ ok: true, config: updated });
});

// Sirve el QR de pago desde Drive vía un endpoint protegido (autenticado,
// tanto en /admin como en /client) en vez de depender de un enlace público
// de Drive. Si todavía no hay un QR en Drive (solo el legado de Cloudinary),
// devuelve 404 — el frontend cae a `config.qrUrl` en ese caso.
const downloadPaymentQr = asyncHandler(async (req, res) => {
  const config = await prisma.paymentConfiguration.findFirst();
  if (!config?.qrDriveFileId) throw ApiError.notFound('No hay un QR de pago almacenado en Drive.');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(config.qrDriveFileId);
  res.setHeader('Content-Type', mimeType || 'image/png');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || 'qr-pago.png')}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

const listPaymentReports = asyncHandler(async (req, res) => {
  const { status, clientId, apiSubaccountId } = req.query;
  const reports = await prisma.paymentReport.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(apiSubaccountId ? { apiSubaccountId } : {}),
      ...(clientId ? { apiSubaccount: { clientId } } : {}),
    },
    orderBy: { reportedAt: 'desc' },
    include: { apiSubaccount: { select: { identifier: true, client: { select: { firstName: true, lastName: true } } } } },
  });
  res.json({ ok: true, reports });
});

const createPaymentReportSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().optional(),
});

// El comprobante de pago es un DOCUMENTO → Google Drive (aunque sea una captura de pantalla)
const createPaymentReport = asyncHandler(async (req, res) => {
  const { amount, currency } = createPaymentReportSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: req.params.apiSubaccountId },
    include: { client: true },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  let proofData = {};
  if (req.file) {
    await assertDriveReady();
    const { paymentsFolderId } = await driveStorage.ensureClientFolders(subaccount.client);
    const uploaded = await driveStorage.uploadFileToDrive(req.file.buffer, {
      folderId: paymentsFolderId,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    proofData = {
      proofDriveFileId: uploaded.id,
      proofDriveFolderId: paymentsFolderId,
      proofFileName: req.file.originalname,
      proofMimeType: req.file.mimetype,
      proofSizeBytes: req.file.size,
    };
  }

  const report = await prisma.paymentReport.create({
    data: {
      apiSubaccountId: subaccount.id,
      amount,
      currency: currency || 'USDT',
      ...proofData,
      status: 'PENDING',
    },
  });

  res.status(201).json({ ok: true, report });
});

const downloadPaymentProof = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const report = await prisma.paymentReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte de pago no encontrado');
  if (!report.proofDriveFileId) throw ApiError.notFound('Este reporte no tiene comprobante adjunto');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(report.proofDriveFileId);
  res.setHeader('Content-Type', mimeType || report.proofMimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(fileName || report.proofFileName || 'comprobante')}"`
  );
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// CORRECCIÓN 10 (bloque de 20) — "Transferencia recibida" es un paso
// INDEPENDIENTE de aprobar el pago: el admin confirma que ya identificó la
// transferencia (revisó monto/hash/fecha/comprobante) sin que eso apruebe
// el pago todavía. Solo "reviewPaymentReport" con status APROBADO
// ("Garantía reportada") mueve el estado final y confirma la condición.
const markTransferReceived = asyncHandler(async (req, res) => {
  const report = await prisma.paymentReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte de pago no encontrado');
  if (report.transferReceivedAt) throw ApiError.conflict('Esta transferencia ya fue marcada como recibida.');

  const updated = await prisma.paymentReport.update({
    where: { id: report.id },
    data: {
      transferReceivedAt: new Date(),
      transferReceivedByUserId: req.user.id,
      // La transferencia recibida es evidencia suficiente para sacarla de
      // "pendiente" y ponerla en revisión activa — pero NUNCA la aprueba.
      status: report.status === 'PENDING' ? 'EN_REVISION' : report.status,
    },
  });

  res.json({ ok: true, report: updated });
});

// AUDITORÍA QLC PARTE 4 — "Garantía reportada" es un paso independiente y
// POSTERIOR a "Transferencia recibida": solo confirma que el admin ya
// reportó/validó la garantía. Todavía NO aprueba el pago — eso requiere la
// acción separada reviewPaymentReport(APROBADO), que ahora exige que este
// paso ya se haya completado.
const markGuaranteeReported = asyncHandler(async (req, res) => {
  const report = await prisma.paymentReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte de pago no encontrado');
  if (!report.transferReceivedAt) {
    throw ApiError.badRequest('Primero debes marcar "Transferencia recibida" antes de reportar la garantía.');
  }
  if (report.guaranteeReportedAt) throw ApiError.conflict('La garantía de este pago ya fue reportada.');

  const updated = await prisma.paymentReport.update({
    where: { id: report.id },
    data: {
      guaranteeReportedAt: new Date(),
      guaranteeReportedByUserId: req.user.id,
      status: 'GARANTIA_REPORTADA',
    },
  });

  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: report.apiSubaccountId } });
  await notifyClient(subaccount.clientId, {
    title: 'Actualización de tu pago reportado',
    message: `La garantía de tu pago de ${report.amount} ${report.currency} fue reportada por QLC. Está en camino de aprobación final.`,
    type: 'info',
    templateKey: 'payment_status_updated',
    templateParams: { amount: String(report.amount), currency: report.currency, status: 'GARANTIA_REPORTADA', apiSubaccountId: subaccount.id },
  });

  res.json({ ok: true, report: updated });
});

const reviewPaymentReportSchema = z.object({
  status: z.enum(['APROBADO', 'RECHAZADO', 'EN_REVISION']),
  reviewNote: z.string().optional(),
});

const reviewPaymentReport = asyncHandler(async (req, res) => {
  const { status, reviewNote } = reviewPaymentReportSchema.parse(req.body);
  const report = await prisma.paymentReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte de pago no encontrado');
  if (status === 'APROBADO' && !report.guaranteeReportedAt) {
    throw ApiError.badRequest('Primero debes marcar "Garantía reportada" antes de aprobar este pago.');
  }

  const updated = await prisma.paymentReport.update({
    where: { id: report.id },
    data: {
      status,
      reviewNote,
      reviewedByUserId: req.user.id,
      reviewedAt: new Date(),
    },
  });

  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: report.apiSubaccountId } });

  if (status === 'APROBADO') {
    const process = await prisma.process.findUnique({ where: { apiSubaccountId: report.apiSubaccountId } });
    if (process) {
      await prisma.processCondition.update({
        where: { processId_type: { processId: process.id, type: 'PAYMENT' } },
        data: { status: 'CONFIRMED' },
      });
    }

    // CORRECCIÓN 25: si el pago corresponde a la comisión de un estado de
    // cuenta, se marca pagada y, si la conexión se había desactivado
    // automáticamente por el plazo de 72h, se reconecta.
    if (report.statementId) {
      await prisma.statement.update({
        where: { id: report.statementId },
        data: { commissionPaid: true, commissionPaidAt: new Date() },
      });

      if (subaccount.status === 'DESCONECTADA') {
        await prisma.apiSubaccount.update({
          where: { id: subaccount.id },
          data: { status: 'CONECTADA', reconnectedAt: new Date() },
        });
        await prisma.apiConnectionEvent.create({
          data: { apiSubaccountId: subaccount.id, eventType: 'RECONNECTED' },
        });
      }
    }
  }

  await notifyClient(subaccount.clientId, {
    title: 'Actualización de tu pago reportado',
    message: `Tu pago de ${report.amount} ${report.currency} fue marcado como: ${status}`,
    type: status === 'APROBADO' ? 'success' : status === 'RECHAZADO' ? 'warning' : 'info',
    templateKey: 'payment_status_updated',
    templateParams: { amount: String(report.amount), currency: report.currency, status, apiSubaccountId: subaccount.id },
  });

  res.json({ ok: true, report: updated });
});

module.exports = {
  getPaymentConfig,
  updatePaymentConfig,
  uploadPaymentQr,
  downloadPaymentQr,
  listPaymentReports,
  createPaymentReport,
  downloadPaymentProof,
  markTransferReceived,
  markGuaranteeReported,
  reviewPaymentReport,
};
