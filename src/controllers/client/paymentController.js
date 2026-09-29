const { z } = require('zod');
const driveStorage = require('../../services/driveStorageService');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyAdmins } = require('../../utils/notify');
const { enforceCommissionDeadline } = require('../../utils/connectionDeadlines');
const { EVIDENCE_MIME, MAX_EVIDENCE_FILES, MAX_EVIDENCE_BYTES } = require('../../middleware/upload');
const { safeFileName } = require('../../utils/supportCaseFiles');
const { EVIDENCE_FILE_SELECT, streamEvidenceFile } = require('../../utils/paymentEvidence');

async function assertOwnsSubaccount(clientId, apiSubaccountId) {
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  return subaccount;
}

// DATOS DE PAGO (UID de recepción Bitget de QLC) — son GENERALES: el admin
// los configura una sola vez y son los mismos para todos los clientes y
// todas sus subcuentas. Se siguen pidiendo desde la subcuenta (se valida
// que sea propia) y el cliente nunca puede modificarlos.
const getSubaccountPaymentData = asyncHandler(async (req, res) => {
  await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  const paymentData = await prisma.paymentConfiguration.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { currency: true, bitgetReceiveUid: true, instructions: true },
  });
  res.json({ ok: true, paymentData });
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
      evidenceFiles: { select: EVIDENCE_FILE_SELECT, orderBy: { createdAt: 'asc' } },
    },
  });
  res.json({ ok: true, reports });
});

// Evidencia propia: se valida que el reporte pertenezca a una subcuenta del
// cliente autenticado antes de servir el archivo desde Drive.
const downloadEvidenceFile = asyncHandler(async (req, res) => {
  const file = await prisma.paymentReportFile.findFirst({
    where: { id: req.params.fileId, paymentReportId: req.params.id },
    include: { paymentReport: { select: { apiSubaccountId: true } } },
  });
  if (!file) throw ApiError.notFound('Archivo de evidencia no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, file.paymentReport.apiSubaccountId);
  await streamEvidenceFile(res, file);
});

// CONFIRMACIÓN DE TRANSFERENCIA INTERNA BITGET — el cliente reporta:
// número de orden/transacción de Bitget + fecha/hora + evidencias (1 a 5
// archivos JPG/PNG/WEBP/PDF). Llega como multipart/form-data.
const createPaymentReportSchema = z.object({
  bitgetOrderNumber: z
    .string({ required_error: 'El número de orden es obligatorio' })
    .trim()
    .min(4, 'El número de orden es obligatorio')
    .max(64, 'El número de orden no puede superar 64 caracteres')
    .regex(/^[A-Za-z0-9-]+$/, 'El número de orden solo puede contener letras, números y guiones'),
  transactionAt: z.coerce.date({ invalid_type_error: 'La fecha y hora de la transacción no es válida' }),
});

// Firma real del contenido (no se confía solo en el Content-Type que manda
// el navegador): JPEG, PNG, WEBP o PDF.
function matchesSignature(file) {
  const b = file.buffer;
  if (!b || b.length < 12) return false;
  switch (file.mimetype) {
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    case 'application/pdf':
      return b.toString('ascii', 0, 5) === '%PDF-';
    default:
      return false;
  }
}

function validateEvidence(files) {
  if (!files || files.length === 0) {
    throw ApiError.badRequest('Adjunta al menos un archivo de evidencia de la transferencia.');
  }
  if (files.length > MAX_EVIDENCE_FILES) throw ApiError.badRequest('Puedes adjuntar como máximo 5 archivos de evidencia.');
  for (const file of files) {
    if (!EVIDENCE_MIME.includes(file.mimetype)) {
      throw ApiError.badRequest('Formato de evidencia no permitido. Solo JPG, PNG, WEBP o PDF.');
    }
    if (file.size === 0) throw ApiError.badRequest('Uno de los archivos de evidencia está vacío.');
    if (file.size > MAX_EVIDENCE_BYTES) throw ApiError.badRequest('Cada archivo de evidencia puede pesar como máximo 5 MB.');
    if (!matchesSignature(file)) {
      throw ApiError.badRequest('Uno de los archivos no es una imagen o PDF válido.');
    }
  }
}

const createPaymentReport = asyncHandler(async (req, res) => {
  const subaccount = await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  if (subaccount.deactivatedAt) throw ApiError.badRequest('Esta subcuenta fue desactivada.');
  const { bitgetOrderNumber, transactionAt } = createPaymentReportSchema.parse(req.body);
  const files = req.files || [];
  validateEvidence(files);

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

  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con el almacenamiento de documentos. Contacta al equipo de QLC.');
  }

  // UID de recepción vigente al momento del reporte (mismo dato que el
  // cliente ve en su subcuenta) — se guarda para la revisión del admin.
  const paymentConfig = await prisma.paymentConfiguration.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { bitgetReceiveUid: true },
  });

  // 1) Evidencias a Drive (subcarpeta "Pagos" del cliente). Si alguna falla,
  //    se retiran las ya subidas y no se crea el reporte.
  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  const uploadedFiles = [];
  try {
    const folderId = await driveStorage.getOrCreateSubfolder(client, 'payments');
    for (const file of files) {
      const fileName = safeFileName(`Evidencia_${bitgetOrderNumber}_${file.originalname}`);
      const uploaded = await driveStorage.uploadFileToDrive(file.buffer, { folderId, fileName, mimeType: file.mimetype });
      uploadedFiles.push({ fileName, mimeType: file.mimetype, sizeBytes: file.size, driveFileId: uploaded.id, driveFolderId: folderId });
    }
  } catch {
    await Promise.all(
      uploadedFiles.map((f) => driveStorage.deleteDriveFileOnlyWhenAuthorized(f.driveFileId, { authorized: true }).catch(() => {}))
    );
    throw ApiError.serviceUnavailable('No se pudo guardar la evidencia en el almacenamiento de documentos. Intenta nuevamente.');
  }

  // 2) Reporte + metadata de evidencias en NeonDB (sin binarios).
  const report = await prisma.paymentReport.create({
    data: {
      apiSubaccountId: subaccount.id,
      currency: 'USDT',
      bitgetOrderNumber,
      transactionAt,
      receiveUid: paymentConfig?.bitgetReceiveUid || null,
      statementId: unpaidStatement?.id || null,
      status: 'PENDING',
      evidenceFiles: { create: uploadedFiles },
    },
    include: { evidenceFiles: { select: EVIDENCE_FILE_SELECT } },
  });

  const clientName = `${req.clientProfile.firstName} ${req.clientProfile.lastName}`;
  await notifyAdmins({
    title: 'Transferencia interna Bitget reportada',
    message: `${clientName} reportó una transferencia interna Bitget (orden ${bitgetOrderNumber}) con ${uploadedFiles.length} archivo(s) de evidencia.`,
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

module.exports = { getSubaccountPaymentData, listPaymentReports, createPaymentReport, downloadPaymentProof, downloadEvidenceFile };
