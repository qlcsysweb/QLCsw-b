const driveStorage = require('../services/driveStorageService');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

async function assertDriveReady() {
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con Google Drive. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
}

const listDocumentsByClient = asyncHandler(async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { clientId: req.params.clientId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, documents });
});

// AUDITORÍA QLC PARTE 1 — el admin NUNCA sube documentos del cliente (solo
// visualiza/descarga/imprime). Se retiró aquí también la función interna de
// subida que ya no estaba conectada a ninguna ruta, para que no quede una
// puerta de subida administrativa lista para reconectarse por error.

// CORREGIR.xlsx ADMIN 07 — el admin puede clasificar/reclasificar un
// documento ya subido dentro del árbol Año → Periodo → Mes (metadata
// organizativa sobre el mismo archivo real en Google Drive; nunca mueve ni
// duplica el archivo físico).
const setDocumentOrganization = asyncHandler(async (req, res) => {
  const { year, month, periodLabel } = req.body;
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: {
      year: year === null || year === undefined || year === '' ? null : Number(year),
      month: month === null || month === undefined || month === '' ? null : Number(month),
      periodLabel: periodLabel || null,
    },
  });

  res.json({ ok: true, document: updated });
});

const downloadDocument = asyncHandler(async (req, res) => {
  await assertDriveReady();
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(document.driveFileId);
  res.setHeader('Content-Type', mimeType || document.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || document.fileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

const deleteDocument = asyncHandler(async (req, res) => {
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  if (await driveStorage.isConfigured()) {
    // Ruta exclusiva de ADMIN (requireRole en el router) — autorizado por rol.
    await driveStorage.deleteDriveFileOnlyWhenAuthorized(document.driveFileId, { authorized: true }).catch(() => {});
  }
  await prisma.document.delete({ where: { id: document.id } });

  await notifyClient(document.clientId, {
    title: 'Puedes volver a enviar tu documento',
    message: `QLC eliminó tu documento de "${document.category}". Ya puedes subir uno nuevo.`,
    type: 'info',
    templateKey: 'document_resubmit',
    templateParams: { category: document.category },
  });

  res.json({ ok: true });
});

// CORRECCIÓN (reversión A): por defecto el documento del cliente está
// bloqueado. Esta acción es la ÚNICA forma de que el cliente pueda
// eliminar/reemplazar un documento puntual — el ADMIN lo habilita
// temporalmente para ese documento específico.
const setDocumentUnlock = asyncHandler(async (req, res) => {
  const unlocked = Boolean(req.body?.unlocked);
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) throw ApiError.notFound('Documento no encontrado');

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: unlocked
      ? { clientEditUnlocked: true, unlockedByUserId: req.user.id, unlockedAt: new Date() }
      : { clientEditUnlocked: false, unlockedByUserId: null, unlockedAt: null },
  });

  if (unlocked) {
    await notifyClient(document.clientId, {
      title: 'Puedes reemplazar un documento',
      message: `QLC habilitó temporalmente tu documento de "${document.category}" para que puedas eliminarlo y volver a enviarlo.`,
      type: 'info',
      templateKey: 'document_unlocked',
      templateParams: { category: document.category },
    });
  }

  res.json({ ok: true, document: updated });
});

module.exports = {
  listDocumentsByClient,
  downloadDocument,
  deleteDocument,
  setDocumentUnlock,
  setDocumentOrganization,
};
