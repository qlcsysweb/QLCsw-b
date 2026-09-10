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

// Proceso de activación — por SUBCUENTA/API (CORRECCIÓN 11/12).

const getProcess = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
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

  const process = await prisma.process.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    include: { apiSubaccount: { select: { clientId: true, identifier: true } } },
  });
  if (!process) throw ApiError.notFound('Proceso no encontrado');

  const condition = await prisma.processCondition.update({
    where: { processId_type: { processId: process.id, type } },
    data: { status, note },
  });

  await notifyClient(process.apiSubaccount.clientId, {
    title: 'Actualización de tu proceso',
    message: `${process.apiSubaccount.identifier ? `[${process.apiSubaccount.identifier}] ` : ''}${CONDITION_LABELS[type] || type}: ${status}`,
    type: status === 'REJECTED' ? 'warning' : 'info',
    templateKey: 'process_condition_updated',
    templateParams: { conditionType: type, status, identifier: process.apiSubaccount.identifier },
  });

  res.json({ ok: true, condition });
});

const activateSubaccount = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    include: { conditions: true, apiSubaccount: { select: { clientId: true } } },
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
    where: { id: process.apiSubaccount.clientId },
    data: { status: 'ACTIVE' },
  });

  await notifyClient(process.apiSubaccount.clientId, {
    title: 'Cuenta activada',
    message: 'Tu cuenta QLC ha sido activada.',
    type: 'success',
    templateKey: 'process_activated',
  });

  res.json({ ok: true, process: updatedProcess });
});

const deactivateSubaccount = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    include: { apiSubaccount: { select: { clientId: true } } },
  });
  if (!process) throw ApiError.notFound('Proceso no encontrado');

  const updatedProcess = await prisma.process.update({
    where: { id: process.id },
    data: { isActivated: false, activatedAt: null },
  });

  await prisma.clientProfile.update({
    where: { id: process.apiSubaccount.clientId },
    data: { status: 'REVIEW' },
  });

  res.json({ ok: true, process: updatedProcess });
});

module.exports = { getProcess, updateCondition, activateSubaccount, deactivateSubaccount };
