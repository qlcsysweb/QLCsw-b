const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const driveStorage = require('../services/driveStorageService');
const { generateStatementPdf } = require('../utils/pdf/statementPdf');
const { notifyClient } = require('../utils/notify');
const {
  STATEMENT_DUE_HOURS,
  effectiveStatementStatus,
  currentStatementSummary,
  enforceCommissionDeadline,
} = require('../utils/connectionDeadlines');

function monthLabel(date) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', month: 'long', year: 'numeric' }).format(
    date instanceof Date ? date : new Date(date)
  );
}

/*
 * ESTADO DE CUENTA SIMPLIFICADO — uno por SUBCUENTA/API. El admin lo genera
 * desde la propia subcuenta ("Generar"): NO GENERADO → PENDIENTE DE PAGO y
 * arranca el plazo de 72 h (expiresAt calculado aquí, nunca en frontend).
 * La comunicación al cliente es la mensajería interna + correo del propio
 * sistema de notificaciones — no existe un flujo de "envío" separado.
 */
function shapeStatement(statement) {
  return { ...statement, status: effectiveStatementStatus(statement) };
}

const listStatements = asyncHandler(async (req, res) => {
  await enforceCommissionDeadline(req.params.apiSubaccountId);
  const statements = await prisma.statement.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { generatedAt: 'desc' },
  });
  res.json({ ok: true, statements: statements.map(shapeStatement), current: currentStatementSummary(statements) });
});

const createStatementSchema = z
  .object({
    // "DESDE" se autocompleta desde el periodo anterior de la MISMA
    // subcuenta/API; solo es obligatorio para el primer estado de cuenta.
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date(),
    startingBalance: z.coerce.number(),
    endingBalance: z.coerce.number(),
    resultAmount: z.coerce.number(),
    resultPercentage: z.coerce.number(),
    volatility: z.string().optional(),
    netResult: z.coerce.number().optional(),
    commission: z.coerce.number().min(0).default(0),
    activityNotes: z.string().optional(),
    adminNotes: z.string().optional(),
  })
  .refine((data) => !data.periodStart || data.periodEnd > data.periodStart, {
    message: 'El periodo "hasta" debe ser posterior al periodo "desde".',
    path: ['periodEnd'],
  });

const createStatement = asyncHandler(async (req, res) => {
  const data = createStatementSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: req.params.apiSubaccountId },
    include: {
      client: { include: { user: { select: { email: true } } } },
      clientModel: { include: { model: true } },
    },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  await enforceCommissionDeadline(subaccount.id);
  const unpaid = await prisma.statement.findFirst({
    where: { apiSubaccountId: subaccount.id, status: { in: ['PENDIENTE_DE_PAGO', 'VENCIDO_SIN_PAGAR'] } },
  });
  if (unpaid) {
    throw ApiError.conflict('Esta subcuenta/API ya tiene un estado de cuenta sin pagar. Confirma su pago antes de generar uno nuevo.');
  }

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

  // Fuente de verdad del contador: hora del servidor + 72 h.
  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + STATEMENT_DUE_HOURS * 60 * 60 * 1000);

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
        status: 'PENDIENTE_DE_PAGO',
        generatedAt,
        expiresAt,
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
  if (await driveStorage.isConfigured()) {
    try {
      const pdfBuffer = await generateStatementPdf({
        client: subaccount.client,
        identifier: subaccount.identifier,
        model: subaccount.clientModel?.model,
        statement,
      });
      const statementsFolderId = await driveStorage.getOrCreateSubfolder(subaccount.client, 'statements');
      const fileName = `Estado_de_cuenta_${subaccount.identifier || subaccount.id}_${periodStart
        .toISOString()
        .slice(0, 7)}.pdf`;
      const uploaded = await driveStorage.uploadFileToDrive(pdfBuffer, {
        folderId: statementsFolderId,
        fileName,
        mimeType: 'application/pdf',
      });
      updatedStatement = await prisma.statement.update({
        where: { id: statement.id },
        data: { pdfDriveFileId: uploaded.id, pdfDriveFolderId: statementsFolderId, pdfFileName: fileName },
      });
    } catch {
      // El estado de cuenta queda generado aunque el PDF falle.
    }
  }

  // Mensajería interna + correo (notifyClient crea la notificación y envía
  // el email al correo real del cliente en la misma acción).
  const month = monthLabel(data.periodEnd);
  const identifier = subaccount.identifier || (subaccount.isPrincipal ? 'PRINCIPAL' : '');
  await notifyClient(subaccount.clientId, {
    title: 'Estado de cuenta generado — pendiente de pago',
    message: `Tu estado de cuenta de ${month}${identifier ? ` (subcuenta/API ${identifier})` : ''} fue generado y está PENDIENTE DE PAGO. Dispones de ${STATEMENT_DUE_HOURS} horas para pagarlo mediante Transferencia interna Bitget desde Pagos / Garantía. Si el plazo vence sin pago, la conexión API será desactivada.`,
    type: 'info',
    templateKey: 'statement_generated',
    templateParams: {
      identifier,
      month,
      commission: String(data.commission),
      commissionDueHours: String(STATEMENT_DUE_HOURS),
      apiSubaccountId: subaccount.id,
    },
  });

  res.status(201).json({ ok: true, statement: shapeStatement(updatedStatement) });
});

async function markPaid(statementId) {
  const statement = await prisma.statement.findUnique({
    where: { id: statementId },
    include: { apiSubaccount: true },
  });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  if (statement.status === 'PAGADO') return statement;

  const updated = await prisma.statement.update({
    where: { id: statement.id },
    data: { status: 'PAGADO', paidAt: new Date() },
  });

  // Si la conexión se había desactivado por el vencimiento y ya no queda
  // ningún otro estado de cuenta sin pagar, se reconecta.
  const stillUnpaid = await prisma.statement.count({
    where: { apiSubaccountId: statement.apiSubaccountId, status: { in: ['PENDIENTE_DE_PAGO', 'VENCIDO_SIN_PAGAR'] } },
  });
  if (!stillUnpaid && statement.apiSubaccount.status === 'DESCONECTADA') {
    await prisma.apiSubaccount.update({
      where: { id: statement.apiSubaccountId },
      data: { status: 'CONECTADA', reconnectedAt: new Date() },
    });
    await prisma.apiConnectionEvent.create({ data: { apiSubaccountId: statement.apiSubaccountId, eventType: 'RECONNECTED' } });
  }
  return updated;
}

// Confirmación manual del pago desde la subcuenta (cuando el admin ya
// validó el pago) — PAGADO y desaparece el contador.
const markStatementPaid = asyncHandler(async (req, res) => {
  const updated = await markPaid(req.params.id);
  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: updated.apiSubaccountId } });
  const identifier = subaccount.identifier || (subaccount.isPrincipal ? 'PRINCIPAL' : '');
  await notifyClient(subaccount.clientId, {
    title: 'Estado de cuenta pagado',
    message: `El pago de tu estado de cuenta${identifier ? ` (subcuenta/API ${identifier})` : ''} fue confirmado por QLC. Estado: PAGADO.`,
    type: 'success',
    templateKey: 'statement_paid',
    templateParams: { identifier, apiSubaccountId: subaccount.id },
  });
  res.json({ ok: true, statement: shapeStatement(updated) });
});

const downloadStatementFile = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  if (!statement.pdfDriveFileId) throw ApiError.notFound('El PDF de este estado de cuenta no está disponible');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(statement.pdfDriveFileId);
  res.setHeader('Content-Type', mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || statement.pdfFileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = {
  listStatements,
  createStatement,
  markStatementPaid,
  markPaid,
  downloadStatementFile,
};
