const { z } = require('zod');
const imageStorage = require('../services/imageStorage');
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

// El QR de pago es una IMAGEN → Cloudinary
const uploadPaymentQr = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar una imagen');

  let config = await prisma.paymentConfiguration.findFirst();
  if (!config) config = await prisma.paymentConfiguration.create({ data: {} });

  if (config.qrPublicId) {
    await imageStorage.deleteImage(config.qrPublicId).catch(() => {});
  }

  const image = await imageStorage.uploadImage(req.file.buffer, {
    folder: imageStorage.FOLDERS.PAYMENTS_QR,
  });

  const updated = await prisma.paymentConfiguration.update({
    where: { id: config.id },
    data: { qrUrl: image.url, qrPublicId: image.publicId },
  });

  res.json({ ok: true, config: updated });
});

const listPaymentReports = asyncHandler(async (req, res) => {
  const { status, clientId } = req.query;
  const reports = await prisma.paymentReport.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
    },
    orderBy: { reportedAt: 'desc' },
    include: { client: { select: { firstName: true, lastName: true } } },
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
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  let proofData = {};
  if (req.file) {
    await assertDriveReady();
    const { paymentsFolderId } = await documentStorage.ensureClientFolders(client);
    const uploaded = await documentStorage.uploadDocument(req.file.buffer, {
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
      clientId: client.id,
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

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(report.proofDriveFileId);
  res.setHeader('Content-Type', mimeType || report.proofMimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(fileName || report.proofFileName || 'comprobante')}"`
  );
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

const reviewPaymentReportSchema = z.object({
  status: z.enum(['APROBADO', 'RECHAZADO', 'EN_REVISION']),
  reviewNote: z.string().optional(),
});

const reviewPaymentReport = asyncHandler(async (req, res) => {
  const { status, reviewNote } = reviewPaymentReportSchema.parse(req.body);
  const report = await prisma.paymentReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte de pago no encontrado');

  const updated = await prisma.paymentReport.update({
    where: { id: report.id },
    data: {
      status,
      reviewNote,
      reviewedByUserId: req.user.id,
      reviewedAt: new Date(),
    },
  });

  if (status === 'APROBADO') {
    const process = await prisma.process.findUnique({ where: { clientId: report.clientId } });
    if (process) {
      await prisma.processCondition.update({
        where: { processId_type: { processId: process.id, type: 'PAYMENT' } },
        data: { status: 'CONFIRMED' },
      });
    }
  }

  await notifyClient(report.clientId, {
    title: 'Actualización de tu pago reportado',
    message: `Tu pago de ${report.amount} ${report.currency} fue marcado como: ${status}`,
    type: status === 'APROBADO' ? 'success' : status === 'RECHAZADO' ? 'warning' : 'info',
    templateKey: 'payment_status_updated',
    templateParams: { amount: String(report.amount), currency: report.currency, status },
  });

  res.json({ ok: true, report: updated });
});

module.exports = {
  getPaymentConfig,
  updatePaymentConfig,
  uploadPaymentQr,
  listPaymentReports,
  createPaymentReport,
  downloadPaymentProof,
  reviewPaymentReport,
};
