const { z } = require('zod');
const documentStorage = require('../../services/documentStorage');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyAdmins } = require('../../utils/notify');

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

const getPaymentConfig = asyncHandler(async (req, res) => {
  const config = await prisma.paymentConfiguration.findFirst();
  res.json({ ok: true, config });
});

// Pagos — por SUBCUENTA/API (CORRECCIÓN 11/28): nunca se mezclan entre
// subcuentas de un mismo cliente.
const listPaymentReports = asyncHandler(async (req, res) => {
  await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  const reports = await prisma.paymentReport.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { reportedAt: 'desc' },
  });
  res.json({ ok: true, reports });
});

const createPaymentReportSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().optional(),
  // Dato libre declarado por el cliente (referencia/hash de la operación,
  // últimos dígitos, etc.). Nunca se valida contra el exchange.
  reference: z.string().max(200).optional(),
  statementId: z.string().optional(),
});

// CORRECCIÓN 6 — flujo del cliente: "GARANTÍA — pago de garantía mínimo
// 10% del capital invertido". Esta validación solo aplica al pago inicial
// de garantía (sin statementId); los pagos de comisión ligados a un
// estado de cuenta ya tienen su propio monto definido por el admin.
const createPaymentReport = asyncHandler(async (req, res) => {
  const subaccount = await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  const { amount, currency, reference, statementId } = createPaymentReportSchema.parse(req.body);

  if (!statementId && subaccount.requiredCapital) {
    const minimumGuarantee = Number(subaccount.requiredCapital) * 0.1;
    if (amount < minimumGuarantee) {
      throw ApiError.badRequest(
        `El pago de garantía debe ser de al menos el 10% del capital invertido (mínimo ${minimumGuarantee.toFixed(2)} USDT).`
      );
    }
  }

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
      apiSubaccountId: subaccount.id,
      amount,
      currency: currency || 'USDT',
      reference: reference || null,
      statementId: statementId || null,
      ...proofData,
      status: 'PENDING',
    },
  });

  // El cliente reportó que ya realizó la transferencia — notifica a
  // administración de inmediato (mismo sistema de notificaciones existente,
  // sin módulo paralelo).
  await notifyAdmins({
    title: 'Transferencia reportada',
    message: `${req.clientProfile.firstName} ${req.clientProfile.lastName} indicó que ya realizó la transferencia (${amount} ${currency || 'USDT'}).`,
    type: 'info',
    templateKey: 'payment_reported',
    templateParams: {
      clientName: `${req.clientProfile.firstName} ${req.clientProfile.lastName}`,
      amount: String(amount),
      currency: currency || 'USDT',
    },
  });

  res.status(201).json({ ok: true, report });
});

const downloadPaymentProof = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const report = await prisma.paymentReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte de pago no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, report.apiSubaccountId);
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
