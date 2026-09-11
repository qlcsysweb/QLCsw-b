const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/*
 * CORREGIR.xlsx CLIENTE 07 — "Tu proceso paso a paso" administrable desde
 * el panel (CMS real, vía Prisma), el cliente solo lo consulta. Reemplaza
 * el listado que antes vivía hardcodeado en i18n
 * (clientDashboard.flowRegister/flowMainAccount/...).
 */

const listStepsAdmin = asyncHandler(async (req, res) => {
  const steps = await prisma.processStep.findMany({ orderBy: [{ displayOrder: 'asc' }, { stepNumber: 'asc' }] });
  res.json({ ok: true, steps });
});

const stepSchema = z.object({
  stepNumber: z.coerce.number().int().min(1),
  titleEs: z.string().min(1),
  titleEn: z.string().optional(),
  descriptionEs: z.string().optional(),
  descriptionEn: z.string().optional(),
  displayOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

const createStep = asyncHandler(async (req, res) => {
  const data = stepSchema.parse(req.body);
  const step = await prisma.processStep.create({
    data: { ...data, updatedByUserId: req.user.id },
  });
  res.status(201).json({ ok: true, step });
});

const updateStep = asyncHandler(async (req, res) => {
  const data = stepSchema.partial().parse(req.body);
  const existing = await prisma.processStep.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Paso no encontrado');

  const step = await prisma.processStep.update({
    where: { id: existing.id },
    data: { ...data, updatedByUserId: req.user.id },
  });
  res.json({ ok: true, step });
});

const deleteStep = asyncHandler(async (req, res) => {
  const existing = await prisma.processStep.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Paso no encontrado');
  await prisma.processStep.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// Lectura pública del cliente — solo pasos activos, ordenados.
const listStepsPublic = asyncHandler(async (req, res) => {
  const steps = await prisma.processStep.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { stepNumber: 'asc' }],
  });
  res.json({ ok: true, steps });
});

module.exports = { listStepsAdmin, createStep, updateStep, deleteStep, listStepsPublic };
