const { z } = require('zod');
const driveStorage = require('../services/driveStorageService');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');
const { markPaid } = require('./statementController');

async function assertDriveReady() {
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con Google Drive. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
}

// DATOS DE PAGO POR SUBCUENTA/API — el ADMIN configura el UID de recepción
// Bitget de QLC para CADA subcuenta (Client → ApiSubaccount →
// SubaccountPaymentData → PaymentReport); nunca un dato general del cliente.
const updatePaymentDataSchema = z.object({
  bitgetReceiveUid: z
    .string()
    .trim()
    .max(40, 'El UID no puede superar 40 caracteres')
    .regex(/^[0-9]*$/, 'El UID de Bitget solo puede contener números')
    .optional(),
  instructions: z.string().max(2000).optional(),
});

async function loadSubaccountOr404(id) {
  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id }, select: { id: true } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  return subaccount;
}

const getSubaccountPaymentData = asyncHandler(async (req, res) => {
  await loadSubaccountOr404(req.params.apiSubaccountId);
  const paymentData = await prisma.subaccountPaymentData.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
  });
  res.json({ ok: true, paymentData });
});

const updateSubaccountPaymentData = asyncHandler(async (req, res) => {
  const data = updatePaymentDataSchema.parse(req.body);
  await loadSubaccountOr404(req.params.apiSubaccountId);

  // La moneda de QLC es fija: USDT — nunca se acepta otro valor.
  const values = {
    ...(data.bitgetReceiveUid !== undefined ? { bitgetReceiveUid: data.bitgetReceiveUid || null } : {}),
    ...(data.instructions !== undefined ? { instructions: data.instructions || null } : {}),
    currency: 'USDT',
    updatedByUserId: req.user.id,
  };
  const paymentData = await prisma.subaccountPaymentData.upsert({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    update: values,
    create: { apiSubaccountId: req.params.apiSubaccountId, ...values },
  });
  res.json({ ok: true, paymentData });
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
    include: {
      apiSubaccount: {
        select: {
          identifier: true,
          isPrincipal: true,
          clientId: true,
          client: { select: { firstName: true, lastName: true, username: true } },
        },
      },
      statement: { select: { id: true, status: true, periodEnd: true } },
    },
  });
  res.json({ ok: true, reports });
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
    message: `La garantía de tu transferencia${report.bitgetOrderNumber ? ` (orden ${report.bitgetOrderNumber})` : ''} fue reportada por QLC. Está en camino de aprobación final.`,
    type: 'info',
    templateKey: 'payment_status_updated',
    templateParams: { orderNumber: report.bitgetOrderNumber || '', status: 'GARANTIA_REPORTADA', apiSubaccountId: subaccount.id },
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
  // El pago de un estado de cuenta se confirma directamente (CONFIRMADO);
  // el pago de garantía conserva sus pasos previos obligatorios.
  if (status === 'APROBADO' && !report.statementId && !report.guaranteeReportedAt) {
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
    if (report.statementId) {
      // Pago de estado de cuenta confirmado → PAGADO (desaparece el
      // contador de 72 h) y, si aplica, se reconecta la API.
      await markPaid(report.statementId);
    } else {
      const process = await prisma.process.findUnique({ where: { apiSubaccountId: report.apiSubaccountId } });
      if (process) {
        await prisma.processCondition.update({
          where: { processId_type: { processId: process.id, type: 'PAYMENT' } },
          data: { status: 'CONFIRMED' },
        });
      }
    }
  }

  await notifyClient(subaccount.clientId, {
    title: 'Actualización de tu pago reportado',
    message: `Tu transferencia interna Bitget${report.bitgetOrderNumber ? ` (orden ${report.bitgetOrderNumber})` : ''} fue marcada como: ${status === 'APROBADO' ? 'CONFIRMADA' : status === 'RECHAZADO' ? 'RECHAZADA' : 'EN REVISIÓN'}`,
    type: status === 'APROBADO' ? 'success' : status === 'RECHAZADO' ? 'warning' : 'info',
    templateKey: 'payment_status_updated',
    templateParams: { orderNumber: report.bitgetOrderNumber || '', status, apiSubaccountId: subaccount.id },
  });

  res.json({ ok: true, report: updated });
});

module.exports = {
  getSubaccountPaymentData,
  updateSubaccountPaymentData,
  listPaymentReports,
  downloadPaymentProof,
  markTransferReceived,
  markGuaranteeReported,
  reviewPaymentReport,
};
