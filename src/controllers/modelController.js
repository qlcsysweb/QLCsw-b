const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const listModelsPublic = asyncHandler(async (req, res) => {
  const models = await prisma.model.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
  });
  res.json({ ok: true, models });
});

const listModelsAdmin = asyncHandler(async (req, res) => {
  const models = await prisma.model.findMany({ orderBy: { displayOrder: 'asc' } });
  res.json({ ok: true, models });
});

// CORRECCIÓN 30: los modelos ya no están limitados a un enum fijo — el
// administrador puede crear nuevos sin límite artificial. "key" es un slug
// único de texto libre.
const createModelSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/i, 'El identificador solo puede tener letras, números, guiones y guiones bajos'),
  name: z.string().min(1),
  nameEn: z.string().optional(),
  tagline: z.string().optional(),
  taglineEn: z.string().optional(),
  description: z.string().min(1),
  descriptionEn: z.string().optional(),
  conditions: z.string().optional(),
  conditionsEn: z.string().optional(),
  period: z.string().optional(),
  periodEn: z.string().optional(),
  percentage: z.string().optional(),
  objective: z.string().optional(),
  detailsContent: z.string().optional(),
  detailsContentEn: z.string().optional(),
  displayOrder: z.number().int().optional(),
});

const createModel = asyncHandler(async (req, res) => {
  const data = createModelSchema.parse(req.body);
  const existing = await prisma.model.findUnique({ where: { key: data.key } });
  if (existing) throw ApiError.conflict('Ya existe un modelo con ese identificador.');

  const maxOrder = await prisma.model.aggregate({ _max: { displayOrder: true } });
  const model = await prisma.model.create({
    data: { ...data, displayOrder: data.displayOrder ?? (maxOrder._max.displayOrder || 0) + 1 },
  });

  res.status(201).json({ ok: true, model });
});

const updateModelSchema = z.object({
  name: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  tagline: z.string().optional(),
  taglineEn: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  descriptionEn: z.string().nullable().optional(),
  conditions: z.string().optional(),
  conditionsEn: z.string().nullable().optional(),
  period: z.string().optional(),
  periodEn: z.string().nullable().optional(),
  percentage: z.string().optional(),
  objective: z.string().optional(),
  detailsContent: z.string().nullable().optional(),
  detailsContentEn: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

const updateModel = asyncHandler(async (req, res) => {
  const data = updateModelSchema.parse(req.body);
  const model = await prisma.model.findUnique({ where: { id: req.params.id } });
  if (!model) throw ApiError.notFound('Modelo no encontrado');

  const updated = await prisma.model.update({ where: { id: req.params.id }, data });
  res.json({ ok: true, model: updated });
});

module.exports = { listModelsPublic, listModelsAdmin, createModel, updateModel };
