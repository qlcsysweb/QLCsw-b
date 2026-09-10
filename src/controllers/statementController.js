const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const documentStorage = require('../services/documentStorage');
const { generateStatementPdf } = require('../utils/pdf/statementPdf');
const { notifyClient } = require('../utils/notify');

// CORRECCIÓN 14 — Estados de cuenta, uno por SUBCUENTA/API, nunca mezclados
// entre subcuentas de un mismo cliente.

const listStatements = asyncHandler(async (req, res) => {
  const statements = await prisma.statement.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, statements });
});

const createStatementSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  startingBalance: z.coerce.number(),
  endingBalance: z.coerce.number(),
  resultAmount: z.coerce.number(),
  resultPercentage: z.coerce.number(),
  commission: z.coerce.number().default(0),
  activityNotes: z.string().optional(),
  adminNotes: z.string().optional(),
  // CORRECCIÓN 25: ventana de 72h para pagar la comisión antes de la
  // desactivación automática de la conexión API de la subcuenta.
  commissionDueHours: z.coerce.number().default(72),
});

const createStatement = asyncHandler(async (req, res) => {
  const data = createStatementSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: req.params.apiSubaccountId },
    include: { client: true },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const commissionDueAt =
    data.commission > 0 ? new Date(Date.now() + data.commissionDueHours * 60 * 60 * 1000) : null;

  const statement = await prisma.statement.create({
    data: {
      apiSubaccountId: subaccount.id,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      startingBalance: data.startingBalance,
      endingBalance: data.endingBalance,
      resultAmount: data.resultAmount,
      resultPercentage: data.resultPercentage,
      commission: data.commission,
      activityNotes: data.activityNotes || null,
      adminNotes: data.adminNotes || null,
      commissionDueAt,
      commissionPaid: data.commission <= 0,
      createdByUserId: req.user.id,
    },
  });

  let updatedStatement = statement;
  if (await documentStorage.isConfigured()) {
    try {
      const pdfBuffer = await generateStatementPdf({
        client: subaccount.client,
        identifier: subaccount.identifier,
        statement,
      });
      const { documentsFolderId } = await documentStorage.ensureClientFolders(subaccount.client);
      const fileName = `Estado_de_cuenta_${subaccount.identifier || subaccount.id}_${data.periodStart
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

  res.status(201).json({ ok: true, statement: updatedStatement });
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

module.exports = { listStatements, createStatement, downloadStatementFile };
