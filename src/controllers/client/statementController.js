const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const driveStorage = require('../../services/driveStorageService');
const {
  effectiveStatementStatus,
  currentStatementSummary,
  enforceCommissionDeadline,
} = require('../../utils/connectionDeadlines');

async function assertOwnsSubaccount(clientId, apiSubaccountId) {
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  return subaccount;
}

// Estado de cuenta de una subcuenta propia — mismo cálculo que el admin
// (utils/connectionDeadlines.js), el backend es la fuente de verdad.
const listStatements = asyncHandler(async (req, res) => {
  await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  await enforceCommissionDeadline(req.params.apiSubaccountId);
  const statements = await prisma.statement.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { generatedAt: 'desc' },
    // Los mismos datos que el ADMIN captura al generar el estado de cuenta
    // (solo de subcuentas propias, ver assertOwnsSubaccount).
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      startingBalance: true,
      endingBalance: true,
      resultAmount: true,
      resultPercentage: true,
      volatility: true,
      netResult: true,
      activityNotes: true,
      adminNotes: true,
      commission: true,
      status: true,
      generatedAt: true,
      expiresAt: true,
      paidAt: true,
      pdfDriveFileId: true,
      clientHiddenAt: true,
    },
  });
  // Los borrados por el cliente se envían marcados (clientHidden) en vez de
  // omitirse: el estado ACTUAL se sigue calculando con la lista completa y el
  // panel solo los quita de "Estados de cuenta anteriores".
  res.json({
    ok: true,
    statements: statements.map(({ pdfDriveFileId, clientHiddenAt, ...s }) => ({
      ...s,
      hasPdf: Boolean(pdfDriveFileId),
      status: effectiveStatementStatus(s),
      clientHidden: Boolean(clientHiddenAt),
    })),
    current: currentStatementSummary(statements),
  });
});

const downloadStatementFile = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, statement.apiSubaccountId);
  if (!statement.pdfDriveFileId) throw ApiError.notFound('El PDF de este estado de cuenta no está disponible');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(statement.pdfDriveFileId);
  res.setHeader('Content-Type', mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || statement.pdfFileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// BORRAR DE "ESTADOS DE CUENTA ANTERIORES" (cliente) — solo estados de
// cuenta PAGADOS y nunca el actual (el más reciente). Se oculta únicamente
// para el cliente; el admin conserva el registro completo.
const hideStatement = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement || statement.clientHiddenAt) throw ApiError.notFound('Estado de cuenta no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, statement.apiSubaccountId);
  const latest = await prisma.statement.findFirst({
    where: { apiSubaccountId: statement.apiSubaccountId },
    orderBy: { generatedAt: 'desc' },
    select: { id: true },
  });
  if (latest?.id === statement.id) throw ApiError.badRequest('El estado de cuenta actual no se puede borrar.');
  if (effectiveStatementStatus(statement) !== 'PAGADO') {
    throw ApiError.badRequest('Solo puedes borrar estados de cuenta ya pagados.');
  }
  await prisma.statement.update({ where: { id: statement.id }, data: { clientHiddenAt: new Date() } });
  res.json({ ok: true });
});

module.exports = { listStatements, downloadStatementFile, hideStatement };
