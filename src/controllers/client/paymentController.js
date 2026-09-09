const { z } = require('zod');
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

const getPaymentConfig = asyncHandler(async (req, res) => {
  const config = await prisma.paymentConfiguration.findFirst();
  res.json({ ok: true, config });
});

const listPaymentReports = asyncHandler(async (req, res) => {
  const reports = await prisma.paymentReport.findMany({
    where: { clientId: req.clientProfile.id },
    orderBy: { reportedAt: 'desc' },
  });
  res.json({ ok: true, reports });
});

const createPaymentReportSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().optional(),
  // Dato libre declarado por el cliente (referencia/hash de la operación,
  // últimos dígitos, etc.) — alcance §6: "números, letras u otros datos
  // definidos para la operación". Nunca se valida contra el exchange.
  reference: z.string().max(200).optional(),
});

const createPaymentReport = asyncHandler(async (req, res) => {
  const { amount, currency, reference } = createPaymentReportSchema.parse(req.body);

  let proofData = {};
  if (req.file) {
    await assertDriveReady();
    const { paymentsFolderId } = await documentStorage.ensureClientFolders(req.clientProfile);
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
      clientId: req.clientProfile.id,
      amount,
      currency: currency || 'USDT',
      reference: reference || null,
      ...proofData,
      status: 'PENDING',
    },
  });

  res.status(201).json({ ok: true, report });
});

const downloadPaymentProof = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const report = await prisma.paymentReport.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
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

module.exports = { getPaymentConfig, listPaymentReports, createPaymentReport, downloadPaymentProof };
