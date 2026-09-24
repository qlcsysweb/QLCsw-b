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
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      commission: true,
      status: true,
      generatedAt: true,
      expiresAt: true,
      paidAt: true,
      pdfDriveFileId: true,
    },
  });
  res.json({
    ok: true,
    statements: statements.map(({ pdfDriveFileId, ...s }) => ({ ...s, hasPdf: Boolean(pdfDriveFileId), status: effectiveStatementStatus(s) })),
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

module.exports = { listStatements, downloadStatementFile };
