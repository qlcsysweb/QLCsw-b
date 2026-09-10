const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const documentStorage = require('../../services/documentStorage');

async function assertOwnsSubaccount(clientId, apiSubaccountId) {
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  return subaccount;
}

// CORRECCIÓN 5: estado visible derivado — nunca una columna redundante que
// pueda desincronizarse del dato real (commission/commissionPaid).
function displayStatusOf(statement) {
  if (Number(statement.commission) > 0 && !statement.commissionPaid) return 'PENDIENTE_DE_PAGO';
  return 'DISPONIBLE';
}

function shapeStatement(statement) {
  return { ...statement, displayStatus: displayStatusOf(statement) };
}

const listStatements = asyncHandler(async (req, res) => {
  await assertOwnsSubaccount(req.clientProfile.id, req.params.apiSubaccountId);
  const statements = await prisma.statement.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { createdAt: 'desc' },
    include: { evidenceDocuments: true },
  });
  res.json({ ok: true, statements: statements.map(shapeStatement) });
});

const downloadStatementFile = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, statement.apiSubaccountId);
  if (!statement.pdfDriveFileId) throw ApiError.notFound('El PDF de este estado de cuenta no está disponible');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(statement.pdfDriveFileId);
  res.setHeader('Content-Type', mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || statement.pdfFileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// CORRECCIÓN 5: el cliente puede ver (nunca modificar) la evidencia
// documental que el admin adjuntó a su estado de cuenta.
const listStatementEvidence = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  await assertOwnsSubaccount(req.clientProfile.id, statement.apiSubaccountId);

  const documents = await prisma.document.findMany({
    where: { statementId: statement.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, documents });
});

module.exports = { listStatements, downloadStatementFile, listStatementEvidence };
