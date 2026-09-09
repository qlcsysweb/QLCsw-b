const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const documentStorage = require('../services/documentStorage');

/*
 * Configuración global única (singleton) para dos elementos del alcance:
 *  - Liga configurable hacia la plataforma externa (§9).
 *  - PDF informativo adjunto al correo de bienvenida de un prospecto (§1).
 * Ninguno de los dos depende de un cliente — es la misma configuración
 * para toda la plataforma, igual que PaymentConfiguration.
 */
async function getOrCreateSettings() {
  const existing = await prisma.platformSettings.findFirst();
  if (existing) return existing;
  return prisma.platformSettings.create({ data: {} });
}

const getPlatformSettingsAdmin = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSettings();
  res.json({ ok: true, settings });
});

const updateSettingsSchema = z.object({
  externalPlatformUrl: z.string().url().optional().or(z.literal('')),
});

const updatePlatformSettings = asyncHandler(async (req, res) => {
  const data = updateSettingsSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.platformSettings.update({
    where: { id: settings.id },
    data: { externalPlatformUrl: data.externalPlatformUrl || null },
  });
  res.json({ ok: true, settings: updated });
});

async function assertDriveReady() {
  if (!(await documentStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con Google Drive. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
}

// Sube (o reemplaza) el PDF informativo — elimina el anterior de Drive si
// existía, nunca deja dos archivos activos a la vez.
const uploadInfoPdf = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo');
  await assertDriveReady();

  const settings = await getOrCreateSettings();

  if (settings.infoPdfDriveFileId) {
    await documentStorage.deleteDocument(settings.infoPdfDriveFileId).catch(() => {});
  }

  const folderId = await documentStorage.ensurePlatformFolder();
  const uploaded = await documentStorage.uploadDocument(req.file.buffer, {
    folderId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const updated = await prisma.platformSettings.update({
    where: { id: settings.id },
    data: {
      infoPdfDriveFileId: uploaded.id,
      infoPdfDriveFolderId: folderId,
      infoPdfFileName: req.file.originalname,
      infoPdfMimeType: req.file.mimetype,
      infoPdfSizeBytes: req.file.size,
    },
  });

  res.status(201).json({ ok: true, settings: updated });
});

const deleteInfoPdf = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSettings();
  if (!settings.infoPdfDriveFileId) throw ApiError.notFound('No hay un PDF informativo configurado');

  if (await documentStorage.isConfigured()) {
    await documentStorage.deleteDocument(settings.infoPdfDriveFileId).catch(() => {});
  }

  const updated = await prisma.platformSettings.update({
    where: { id: settings.id },
    data: {
      infoPdfDriveFileId: null,
      infoPdfDriveFolderId: null,
      infoPdfFileName: null,
      infoPdfMimeType: null,
      infoPdfSizeBytes: null,
    },
  });

  res.json({ ok: true, settings: updated });
});

// Lectura pública/cliente — solo la liga, nunca los datos internos del PDF.
const getPlatformLinkForClient = asyncHandler(async (req, res) => {
  const settings = await prisma.platformSettings.findFirst();
  res.json({ ok: true, externalPlatformUrl: settings?.externalPlatformUrl || null });
});

module.exports = {
  getPlatformSettingsAdmin,
  updatePlatformSettings,
  uploadInfoPdf,
  deleteInfoPdf,
  getPlatformLinkForClient,
};
