const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/*
 * MODELO ÚNICO DE PARTICIPACIÓN — QLC 70% / Cliente 30%. Ya no existen
 * otros modelos ni selector: cada subcuenta queda asignada automáticamente
 * a este modelo (ver utils/subaccountProvisioning.ensureParticipationModel).
 * El admin solo puede editar sus textos; no se pueden crear modelos nuevos
 * ni desactivar el único existente.
 */
const listModelsPublic = asyncHandler(async (req, res) => {
  const models = await prisma.model.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
  });
  res.json({ ok: true, models });
});

const listModelsAdmin = asyncHandler(async (req, res) => {
  const models = await prisma.model.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } });
  res.json({ ok: true, models });
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
  detailsContent: z.string().nullable().optional(),
  detailsContentEn: z.string().nullable().optional(),
});

const updateModel = asyncHandler(async (req, res) => {
  const data = updateModelSchema.parse(req.body);
  const model = await prisma.model.findUnique({ where: { id: req.params.id } });
  if (!model) throw ApiError.notFound('Modelo no encontrado');

  const updated = await prisma.model.update({ where: { id: req.params.id }, data });
  res.json({ ok: true, model: updated });
});

module.exports = { listModelsPublic, listModelsAdmin, updateModel };
