const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { uploadGuidePdf, deleteGuidePdf } = require('../services/guideStorage');

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

const getPlatformLinkForClient = asyncHandler(async (req, res) => {
  const settings = await prisma.platformSettings.findFirst();
  res.json({ ok: true, externalPlatformUrl: settings?.externalPlatformUrl || null });
});

// CORRECCIÓN 27: las dos guías de uso (ADMIN / CLIENTE) — los ÚNICOS PDFs
// almacenados en Cloudinary. NO deben confundirse con el antiguo "PDF
// informativo" (CORRECCIÓN 4), que fue eliminado por completo del sistema.
const ROLE_FIELD_MAP = {
  ADMIN: {
    urlField: 'adminGuidePdfUrl',
    publicIdField: 'adminGuidePdfPublicId',
    nameField: 'adminGuideFileName',
    publicIdPrefix: 'admin-guide',
  },
  CLIENT: {
    urlField: 'clientGuidePdfUrl',
    publicIdField: 'clientGuidePdfPublicId',
    nameField: 'clientGuideFileName',
    publicIdPrefix: 'client-guide',
  },
};

const uploadGuide = asyncHandler(async (req, res) => {
  const role = req.params.role?.toUpperCase();
  const fields = ROLE_FIELD_MAP[role];
  if (!fields) throw ApiError.badRequest('Rol de guía no válido');
  if (!req.file) throw ApiError.badRequest('Debes adjuntar un archivo PDF');

  const settings = await getOrCreateSettings();
  if (settings[fields.publicIdField]) {
    await deleteGuidePdf(settings[fields.publicIdField]).catch(() => {});
  }

  const uploaded = await uploadGuidePdf(req.file.buffer, `${fields.publicIdPrefix}-${Date.now()}`);

  const updated = await prisma.platformSettings.update({
    where: { id: settings.id },
    data: {
      [fields.urlField]: uploaded.url,
      [fields.publicIdField]: uploaded.publicId,
      [fields.nameField]: req.file.originalname,
    },
  });

  res.status(201).json({ ok: true, settings: updated });
});

const deleteGuide = asyncHandler(async (req, res) => {
  const role = req.params.role?.toUpperCase();
  const fields = ROLE_FIELD_MAP[role];
  if (!fields) throw ApiError.badRequest('Rol de guía no válido');

  const settings = await getOrCreateSettings();
  if (!settings[fields.publicIdField]) throw ApiError.notFound('No hay una guía configurada para este rol');

  await deleteGuidePdf(settings[fields.publicIdField]).catch(() => {});

  const updated = await prisma.platformSettings.update({
    where: { id: settings.id },
    data: { [fields.urlField]: null, [fields.publicIdField]: null, [fields.nameField]: null },
  });

  res.json({ ok: true, settings: updated });
});

// El cliente/admin autenticado descarga SU guía según su propio rol — nunca
// la del otro rol (alcance explícito de la corrección 27).
const downloadMyGuide = asyncHandler(async (req, res) => {
  const fields = ROLE_FIELD_MAP[req.user.role];
  const settings = await prisma.platformSettings.findFirst();
  const url = settings?.[fields.urlField];
  if (!url) throw ApiError.notFound('Todavía no hay una guía de uso disponible.');
  res.json({ ok: true, url, fileName: settings[fields.nameField] });
});

module.exports = {
  getPlatformSettingsAdmin,
  updatePlatformSettings,
  getPlatformLinkForClient,
  uploadGuide,
  deleteGuide,
  downloadMyGuide,
};
