const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// CORRECCIÓN 1/6/20/21 — Guías de Uso: biblioteca de contenido HTML
// editable por ADMIN. El PDF (platformSettingsController) se conserva como
// descarga opcional adicional — esta es ahora la fuente principal.

const listGuidesAdmin = asyncHandler(async (req, res) => {
  const guides = await prisma.guide.findMany({ orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] });
  res.json({ ok: true, guides });
});

const guideSchema = z.object({
  titleEs: z.string().min(1, 'El título es obligatorio'),
  titleEn: z.string().optional(),
  descriptionEs: z.string().optional(),
  descriptionEn: z.string().optional(),
  contentEs: z.string().min(1, 'El contenido es obligatorio'),
  contentEn: z.string().optional(),
  audience: z.enum(['CLIENT', 'ADMIN', 'BOTH']).default('CLIENT'),
  displayOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

const createGuide = asyncHandler(async (req, res) => {
  const data = guideSchema.parse(req.body);
  const guide = await prisma.guide.create({
    data: {
      ...data,
      titleEn: data.titleEn || null,
      descriptionEs: data.descriptionEs || null,
      descriptionEn: data.descriptionEn || null,
      contentEn: data.contentEn || null,
    },
  });
  res.status(201).json({ ok: true, guide });
});

const updateGuideSchema = guideSchema.partial();

const updateGuide = asyncHandler(async (req, res) => {
  const data = updateGuideSchema.parse(req.body);
  const existing = await prisma.guide.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Guía no encontrada');

  const guide = await prisma.guide.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ ok: true, guide });
});

const deleteGuide = asyncHandler(async (req, res) => {
  const existing = await prisma.guide.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Guía no encontrada');
  await prisma.guide.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = { listGuidesAdmin, createGuide, updateGuide, deleteGuide };
