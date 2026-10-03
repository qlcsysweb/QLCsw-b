const { syncClientStatus } = require('../utils/clientStatus');
const { z } = require('zod');
const { clientSubaccountLabel } = require('../utils/subaccountLabels');
const { syncConnectionFromCondition } = require('../utils/apiConnectionSync');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

const CONDITION_LABELS = {
  FUNDS: 'Fondos disponibles',
  PAYMENT: 'Pago reportado',
  API: 'Conexión API',
  ACTIVATION: 'Activación',
};

// Proceso de activación — por SUBCUENTA/API (CORRECCIÓN 11/12).

const getProcess = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    include: { conditions: { where: { type: { not: 'WALLET' } } } },
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
    include: { apiSubaccount: { select: { clientId: true, isPrincipal: true, slotIndex: true } } },
  });
  if (!process) throw ApiError.notFound('Proceso no encontrado');

  const condition = await prisma.processCondition.update({
    where: { processId_type: { processId: process.id, type } },
    data: { status, note },
  });

  // El paso "Conexión API" y el estado de la conexión siempre coinciden:
  // rechazarlo desconecta la API, confirmarlo la conecta.
  if (type === 'API') {
    await syncConnectionFromCondition(req.params.apiSubaccountId, status, req.user.id);
  }

  await notifyClient(process.apiSubaccount.clientId, {
    title: 'Actualización de tu proceso',
    message: `[${clientSubaccountLabel(process.apiSubaccount)}] ${CONDITION_LABELS[type] || type}: ${status}`,
    type: status === 'REJECTED' ? 'warning' : 'info',
    templateKey: 'process_condition_updated',
    templateParams: { conditionType: type, status, identifier: clientSubaccountLabel(process.apiSubaccount), apiSubaccountId: req.params.apiSubaccountId },
  });

  res.json({ ok: true, condition });
});

const activateSubaccount = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    include: { conditions: { where: { type: { not: 'WALLET' } } }, apiSubaccount: { select: { clientId: true } } },
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

  await syncClientStatus(process.apiSubaccount.clientId);

  await notifyClient(process.apiSubaccount.clientId, {
    title: 'Cuenta activada',
    message: 'Tu cuenta QLC ha sido activada.',
    type: 'success',
    templateKey: 'process_activated',
    templateParams: { apiSubaccountId: req.params.apiSubaccountId },
  });

  res.json({ ok: true, process: updatedProcess });
});

const deactivateSubaccount = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    include: { apiSubaccount: { select: { clientId: true, isPrincipal: true, slotIndex: true } } },
  });
  if (!process) throw ApiError.notFound('Proceso no encontrado');

  const updatedProcess = await prisma.process.update({
    where: { id: process.id },
    data: { isActivated: false, activatedAt: null },
  });

  // En revisión solo si ya no le queda ninguna otra cuenta activada.
  await prisma.clientProfile.update({ where: { id: process.apiSubaccount.clientId }, data: { status: 'REVIEW' } });
  await syncClientStatus(process.apiSubaccount.clientId);

  const identifier = clientSubaccountLabel(process.apiSubaccount);
  await notifyClient(process.apiSubaccount.clientId, {
    title: 'Cuenta desactivada',
    message: `Tu cuenta QLC${identifier ? ` (${identifier})` : ''} fue desactivada y vuelve a estar en revisión.`,
    type: 'warning',
    templateKey: 'subaccount_deactivated',
    templateParams: { identifier, apiSubaccountId: req.params.apiSubaccountId },
  });

  res.json({ ok: true, process: updatedProcess });
});

module.exports = { getProcess, updateCondition, activateSubaccount, deactivateSubaccount };
