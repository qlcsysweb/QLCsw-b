const { z } = require('zod');
const driveStorage = require('../../services/driveStorageService');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyAdmins } = require('../../utils/notify');
const { enforceCommissionDeadline } = require('../../utils/connectionDeadlines');

async function assertOwnsSubaccount(clientId, apiSubaccountId) {
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  return subaccount;
}

// TRANSFERENCIA INTERNA BITGET — el cliente solo ve (y copia) el UID de
// recepción que administra QLC. Nunca puede modificarlo.
const getPaymentConfig = asyncHandler(async (req, res) => {
  const config = await prisma.paymentConfiguration.findFirst({
    select: { currency: true, bitgetReceiveUid: true, instructions: true },
  });
  res.json({ ok: true, config });
});

// Pagos — por SUBCUENTA/API: nunca se mezclan entre subcuentas del cliente.
const listPaymentReports = asyncHandler(async (req, res) => {
  await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  const reports = await prisma.paymentReport.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { reportedAt: 'desc' },
    select: {
      id: true,
      amount: true,
      currency: true,
      reference: true,
      bitgetOrderNumber: true,
      transactionAt: true,
      status: true,
      reportedAt: true,
      reviewedAt: true,
      statementId: true,
      proofDriveFileId: true,
      proofFileName: true,
    },
  });
  res.json({ ok: true, reports });
});

// El cliente reporta SOLO dos datos: número de orden y fecha/hora de la
// transacción. Nada de wallet, red, dirección, hash ni capturas.
const createPaymentReportSchema = z.object({
  bitgetOrderNumber: z
    .string({ required_error: 'El número de orden es obligatorio' })
    .trim()
    .min(4, 'El número de orden es obligatorio')
    .max(64, 'El número de orden no puede superar 64 caracteres')
    .regex(/^[A-Za-z0-9-]+$/, 'El número de orden solo puede contener letras, números y guiones'),
  transactionAt: z.coerce.date({ invalid_type_error: 'La fecha y hora de la transacción no es válida' }),
});

const createPaymentReport = asyncHandler(async (req, res) => {
  const subaccount = await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  if (subaccount.deactivatedAt) throw ApiError.badRequest('Esta subcuenta fue desactivada.');
  const { bitgetOrderNumber, transactionAt } = createPaymentReportSchema.parse(req.body);

  // Tolerancia de 10 min por diferencias de reloj; nunca una fecha futura.
  if (transactionAt.getTime() > Date.now() + 10 * 60 * 1000) {
    throw ApiError.badRequest('La fecha y hora de la transacción no puede estar en el futuro.');
  }

  const duplicate = await prisma.paymentReport.findFirst({
    where: { bitgetOrderNumber, status: { not: 'RECHAZADO' } },
    select: { id: true },
  });
  if (duplicate) throw ApiError.conflict('Ese número de orden ya fue reportado.');

  // Si la subcuenta tiene un estado de cuenta sin pagar, el reporte se
  // asocia a él automáticamente (el cliente no tiene que elegir nada).
  await enforceCommissionDeadline(subaccount.id);
  const unpaidStatement = await prisma.statement.findFirst({
    where: { apiSubaccountId: subaccount.id, status: { in: ['PENDIENTE_DE_PAGO', 'VENCIDO_SIN_PAGAR'] } },
    orderBy: { generatedAt: 'desc' },
    select: { id: true },
  });

  const report = await prisma.paymentReport.create({
    data: {
      apiSubaccountId: subaccount.id,
      currency: 'USDT',
      bitgetOrderNumber,
      transactionAt,
      statementId: unpaidStatement?.id || null,
      status: 'PENDING',
    },
  });

  const clientName = `${req.clientProfile.firstName} ${req.clientProfile.lastName}`;
  await notifyAdmins({
    title: 'Transferencia interna Bitget reportada',
    message: `${clientName} reportó una transferencia interna Bitget (orden ${bitgetOrderNumber}).`,
    type: 'info',
    templateKey: 'payment_reported',
    templateParams: {
      clientName,
      orderNumber: bitgetOrderNumber,
      apiSubaccountId: subaccount.id,
      clientId: req.clientProfile.id,
    },
  });

  res.status(201).json({ ok: true, report });
});

// Comprobantes históricos (reportes anteriores a la transferencia interna
// Bitget) — solo descarga.
const downloadPaymentProof = asyncHandler(async (req, res) => {
  const report = await prisma.paymentReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte de pago no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, report.apiSubaccountId);
  if (!report.proofDriveFileId) throw ApiError.notFound('Este reporte no tiene comprobante adjunto');
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con el almacenamiento de documentos. Contacta al equipo de QLC.');
  }

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(report.proofDriveFileId);
  res.setHeader('Content-Type', mimeType || report.proofMimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(fileName || report.proofFileName || 'comprobante')}"`
  );
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = { getPaymentConfig, listPaymentReports, createPaymentReport, downloadPaymentProof };
