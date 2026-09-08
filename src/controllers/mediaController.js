const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const mediaStorage = require('../services/mediaStorage');

// Fuente única de verdad de ubicaciones válidas — debe reflejar las
// secciones reales de la página pública (ver PublicHomePage.jsx) + "logo".
const LOCATIONS = [
  'logo',
  'hero',
  'modelo',
  'como_funciona',
  'tecnologia',
  'microposiciones',
  'modelos',
  'resultados',
  'seguridad',
  'sobre_qlc',
  'faq',
  'contacto',
  'footer',
];

const listMediaAdmin = asyncHandler(async (req, res) => {
  const { location } = req.query;
  const items = await prisma.mediaAsset.findMany({
    where: location ? { location } : {},
    orderBy: [{ location: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ ok: true, items, locations: LOCATIONS });
});

const createMediaSchema = z.object({
  location: z.enum(LOCATIONS),
  title: z.string().optional(),
  description: z.string().optional(),
});

const createMedia = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar una imagen o un video');
  const { location, title, description } = createMediaSchema.parse(req.body);

  const uploaded = await mediaStorage.uploadMedia(req.file.buffer, req.file.mimetype, {
    isLogo: location === 'logo',
  });

  const siblingCount = await prisma.mediaAsset.count({ where: { location } });

  const asset = await prisma.mediaAsset.create({
    data: {
      fileName: req.file.originalname,
      type: uploaded.type,
      format: uploaded.format,
      url: uploaded.url,
      publicId: uploaded.publicId,
      bytes: uploaded.bytes,
      location,
      title: title || null,
      description: description || null,
      order: siblingCount,
      updatedByUserId: req.user.id,
    },
  });

  res.status(201).json({ ok: true, item: asset });
});

const updateMediaSchema = z.object({
  location: z.enum(LOCATIONS).optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  order: z.coerce.number().int().min(0).optional(),
  isPublished: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});

const updateMedia = asyncHandler(async (req, res) => {
  const data = updateMediaSchema.parse(req.body);
  const existing = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Este recurso multimedia ya no existe');

  const targetLocation = data.location || existing.location;

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isPrimary === true) {
      await tx.mediaAsset.updateMany({
        where: { location: targetLocation, NOT: { id: existing.id } },
        data: { isPrimary: false },
      });
    }
    return tx.mediaAsset.update({
      where: { id: existing.id },
      data: { ...data, updatedByUserId: req.user.id },
    });
  });

  res.json({ ok: true, item: updated });
});

const replaceMediaFile = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Debes adjuntar el nuevo archivo');
  const existing = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Este recurso multimedia ya no existe');

  const uploaded = await mediaStorage.uploadMedia(req.file.buffer, req.file.mimetype, {
    isLogo: existing.location === 'logo',
  });

  // Se sube el nuevo archivo primero; solo si todo sale bien se borra el
  // anterior de Cloudinary, evitando quedarnos sin archivo ante un error.
  const updated = await prisma.mediaAsset.update({
    where: { id: existing.id },
    data: {
      fileName: req.file.originalname,
      type: uploaded.type,
      format: uploaded.format,
      url: uploaded.url,
      publicId: uploaded.publicId,
      bytes: uploaded.bytes,
      updatedByUserId: req.user.id,
    },
  });

  await mediaStorage.deleteMedia(existing.publicId, existing.type).catch(() => {});

  res.json({ ok: true, item: updated });
});

const deleteMedia = asyncHandler(async (req, res) => {
  const existing = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Este recurso multimedia ya no existe');

  await prisma.mediaAsset.delete({ where: { id: existing.id } });
  await mediaStorage.deleteMedia(existing.publicId, existing.type).catch(() => {});

  res.json({ ok: true });
});

module.exports = { LOCATIONS, listMediaAdmin, createMedia, updateMedia, replaceMediaFile, deleteMedia };
