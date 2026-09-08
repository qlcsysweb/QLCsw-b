const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

const CONDITION_LABELS = {
  CONTRACT: 'Contrato firmado',
  FUNDS: 'Fondos disponibles',
  PAYMENT: 'Pago reportado',
  API: 'Conexión API',
  ACTIVATION: 'Activación',
};

const getProcess = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { clientId: req.params.clientId },
    include: { conditions: true },
  });
  if (!process) throw ApiError.notFound('Proceso no encontrado');
  res.json({ ok: true, process });
});

const updateConditionSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']),
  note: z.string().optional(),
});

const updateCondition = asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { status, note } = updateConditionSchema.parse(req.body);

  const process = await prisma.process.findUnique({ where: { clientId: req.params.clientId } });
  if (!process) throw ApiError.notFound('Proceso no encontrado');

  const condition = await prisma.processCondition.update({
    where: { processId_type: { processId: process.id, type } },
    data: { status, note },
  });

  await notifyClient(req.params.clientId, {
    title: 'Actualización de tu proceso',
    message: `${CONDITION_LABELS[type] || type}: ${status}`,
    type: status === 'REJECTED' ? 'warning' : 'info',
  });

  res.json({ ok: true, condition });
});

const activateClient = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { clientId: req.params.clientId },
    include: { conditions: true },
  });
  if (!process) throw ApiError.notFound('Proceso no encontrado');

  const allConfirmed = process.conditions.every((c) => c.status === 'CONFIRMED');
  if (!allConfirmed) {
    throw ApiError.unprocessable(
      'No se puede activar: existen condiciones del proceso sin confirmar.'
    );
  }

  const updatedProcess = await prisma.process.update({
    where: { id: process.id },
    data: { isActivated: true, activatedAt: new Date() },
  });

  await prisma.clientProfile.update({
    where: { id: req.params.clientId },
    data: { status: 'ACTIVE' },
  });

  await notifyClient(req.params.clientId, {
    title: 'Cuenta activada',
    message: 'Tu cuenta QLC ha sido activada.',
    type: 'success',
  });

  res.json({ ok: true, process: updatedProcess });
});

const deactivateClient = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({ where: { clientId: req.params.clientId } });
  if (!process) throw ApiError.notFound('Proceso no encontrado');

  const updatedProcess = await prisma.process.update({
    where: { id: process.id },
    data: { isActivated: false, activatedAt: null },
  });

  await prisma.clientProfile.update({
    where: { id: req.params.clientId },
    data: { status: 'REVIEW' },
  });

  res.json({ ok: true, process: updatedProcess });
});

module.exports = { getProcess, updateCondition, activateClient, deactivateClient };
