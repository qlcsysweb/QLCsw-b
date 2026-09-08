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

const updateModelSchema = z.object({
  name: z.string().min(1).optional(),
  tagline: z.string().optional(),
  description: z.string().min(1).optional(),
  conditions: z.string().optional(),
  period: z.string().optional(),
  percentage: z.string().optional(),
  objective: z.string().optional(),
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

module.exports = { listModelsPublic, listModelsAdmin, updateModel };
