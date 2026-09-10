const path = require('path');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const documentStorage = require('../services/documentStorage');
const { generateStatementPdf } = require('../utils/pdf/statementPdf');
const { notifyClient } = require('../utils/notify');

// CORRECCIÓN 14 — Estados de cuenta, uno por SUBCUENTA/API, nunca mezclados
// entre subcuentas de un mismo cliente.
// CORRECCIÓN 5 — se añade estado visible derivado (DISPONIBLE/PENDIENTE_DE_PAGO),
// periodo "DESDE" autocompletado desde el periodo anterior, evidencias
// documentales y reenvío de la notificación al cliente.

// Estado visible derivado — nunca se guarda como columna redundante, se
// calcula siempre a partir de commission/commissionPaid para que jamás
// pueda desincronizarse del dato real.
function displayStatusOf(statement) {
  if (Number(statement.commission) > 0 && !statement.commissionPaid) return 'PENDIENTE_DE_PAGO';
  return 'DISPONIBLE';
}

function shapeStatement(statement) {
  return { ...statement, displayStatus: displayStatusOf(statement) };
}

const listStatements = asyncHandler(async (req, res) => {
  const statements = await prisma.statement.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { createdAt: 'desc' },
    include: { evidenceDocuments: true },
  });
  res.json({ ok: true, statements: statements.map(shapeStatement) });
});

const createStatementSchema = z
  .object({
    // CORRECCIÓN 5: "DESDE" se autocompleta desde el periodo anterior de la
    // MISMA subcuenta/API cuando ya existe uno — el admin solo captura
    // "HASTA". Solo es obligatorio escribirlo a mano para el primer estado
    // de cuenta de esa subcuenta (todavía no hay periodo anterior).
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date(),
    startingBalance: z.coerce.number(),
    endingBalance: z.coerce.number(),
    resultAmount: z.coerce.number(),
    resultPercentage: z.coerce.number(),
    volatility: z.string().optional(),
    netResult: z.coerce.number().optional(),
    commission: z.coerce.number().default(0),
    activityNotes: z.string().optional(),
    adminNotes: z.string().optional(),
    // CORRECCIÓN 25: ventana de 72h para pagar la comisión antes de la
    // desactivación automática de la conexión API de la subcuenta.
    commissionDueHours: z.coerce.number().default(72),
  })
  .refine((data) => !data.periodStart || data.periodEnd > data.periodStart, {
    message: 'El periodo "hasta" debe ser posterior al periodo "desde".',
    path: ['periodEnd'],
  });

const createStatement = asyncHandler(async (req, res) => {
  const data = createStatementSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: req.params.apiSubaccountId },
    include: { client: true, clientModel: { include: { model: true } } },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const previousStatement = await prisma.statement.findFirst({
    where: { apiSubaccountId: subaccount.id },
    orderBy: { periodEnd: 'desc' },
  });

  const periodStart = previousStatement ? previousStatement.periodEnd : data.periodStart;
  if (!periodStart) {
    throw ApiError.badRequest('Indica la fecha "desde" para el primer estado de cuenta de esta subcuenta/API.');
  }
  if (data.periodEnd <= periodStart) {
    throw ApiError.badRequest('El periodo "hasta" debe ser posterior al periodo "desde".');
  }

  const commissionDueAt =
    data.commission > 0 ? new Date(Date.now() + data.commissionDueHours * 60 * 60 * 1000) : null;

  let statement;
  try {
    statement = await prisma.statement.create({
      data: {
        apiSubaccountId: subaccount.id,
        periodStart,
        periodEnd: data.periodEnd,
        startingBalance: data.startingBalance,
        endingBalance: data.endingBalance,
        resultAmount: data.resultAmount,
        resultPercentage: data.resultPercentage,
        volatility: data.volatility || null,
        netResult: data.netResult ?? null,
        commission: data.commission,
        activityNotes: data.activityNotes || null,
        adminNotes: data.adminNotes || null,
        commissionDueAt,
        commissionPaid: data.commission <= 0,
        createdByUserId: req.user.id,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw ApiError.conflict('Ya existe un estado de cuenta para esta subcuenta/API en ese mismo periodo.');
    }
    throw err;
  }

  let updatedStatement = statement;
  if (await documentStorage.isConfigured()) {
    try {
      const pdfBuffer = await generateStatementPdf({
        client: subaccount.client,
        identifier: subaccount.identifier,
        model: subaccount.clientModel?.model,
        statement,
      });
      const { documentsFolderId } = await documentStorage.ensureClientFolders(subaccount.client);
      const fileName = `Estado_de_cuenta_${subaccount.identifier || subaccount.id}_${periodStart
        .toISOString()
        .slice(0, 7)}.pdf`;
      const uploaded = await documentStorage.uploadDocument(pdfBuffer, {
        folderId: documentsFolderId,
        fileName,
        mimeType: 'application/pdf',
      });
      updatedStatement = await prisma.statement.update({
        where: { id: statement.id },
        data: { pdfDriveFileId: uploaded.id, pdfDriveFolderId: documentsFolderId, pdfFileName: fileName },
      });
    } catch {
      // El estado de cuenta queda guardado igual aunque el PDF falle — el
      // admin puede reintentar la descarga/generación más adelante.
    }
  }

  await notifyClient(subaccount.clientId, {
    title: 'Estado de cuenta generado',
    message:
      data.commission > 0
        ? `Su estado de cuenta ha sido generado correctamente. El pago de la comisión correspondiente se encuentra pendiente. Dispone de ${data.commissionDueHours} horas para realizar el pago. Una vez finalizado este plazo sin recibir el pago, la conexión mediante API será desactivada. La conexión será reactivada una vez que el pago haya sido reportado y validado.`
        : 'Su estado de cuenta ha sido generado correctamente.',
    type: 'info',
    templateKey: 'statement_generated',
    templateParams: {
      identifier: subaccount.identifier,
      commission: String(data.commission),
      commissionDueHours: String(data.commissionDueHours),
    },
  });

  res.status(201).json({ ok: true, statement: shapeStatement(updatedStatement) });
});

const downloadStatementFile = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  if (!statement.pdfDriveFileId) throw ApiError.notFound('El PDF de este estado de cuenta no está disponible');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(statement.pdfDriveFileId);
  res.setHeader('Content-Type', mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || statement.pdfFileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// CORRECCIÓN 5: reenvía al cliente la notificación de un estado de cuenta ya
// generado — reutiliza notifyClient, nunca un sistema de notificaciones
// paralelo.
const sendStatementToClient = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({
    where: { id: req.params.id },
    include: { apiSubaccount: true },
  });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');

  await notifyClient(statement.apiSubaccount.clientId, {
    title: 'Estado de cuenta disponible',
    message: `QLC puso a tu disposición nuevamente tu estado de cuenta${
      statement.apiSubaccount.identifier ? ` de la subcuenta/API ${statement.apiSubaccount.identifier}` : ''
    }.`,
    type: 'info',
    templateKey: 'statement_resent',
    templateParams: { identifier: statement.apiSubaccount.identifier },
  });

  res.json({ ok: true });
});

// CORRECCIÓN 5: evidencia documental de un estado de cuenta — reutiliza
// EXACTAMENTE el mismo almacenamiento (Google Drive/Document) que el resto
// de documentos del cliente, nunca una arquitectura paralela.
const uploadStatementEvidence = asyncHandler(async (req, res) => {
  if (!(await documentStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con Google Drive. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo');

  const statement = await prisma.statement.findUnique({
    where: { id: req.params.id },
    include: { apiSubaccount: { include: { client: true } } },
  });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');

  const client = statement.apiSubaccount.client;
  const { documentsFolderId } = await documentStorage.ensureClientFolders(client);

  const uploaded = await documentStorage.uploadDocument(req.file.buffer, {
    folderId: documentsFolderId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const document = await prisma.document.create({
    data: {
      clientId: client.id,
      category: 'evidencia_estado_cuenta',
      description: req.body.description || null,
      driveFileId: uploaded.id,
      driveFolderId: documentsFolderId,
      fileName: req.file.originalname,
      extension: path.extname(req.file.originalname).replace('.', '') || null,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedByUserId: req.user.id,
      statementId: statement.id,
    },
  });

  res.status(201).json({ ok: true, document });
});

const listStatementEvidence = asyncHandler(async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { statementId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, documents });
});

module.exports = {
  listStatements,
  createStatement,
  downloadStatementFile,
  sendStatementToClient,
  uploadStatementEvidence,
  listStatementEvidence,
};
