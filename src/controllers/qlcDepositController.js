const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');
const { clientSubaccountLabel } = require('../utils/subaccountLabels');

/*
 * DEPÓSITOS QUE QLC REALIZA AL CLIENTE (por subcuenta/API).
 * Los registra el ADMIN (fecha, monto, referencia). El cliente los ve en su
 * subcuenta y el afiliador directo en el "Historial registrado por QLC" de su
 * referido. Es un registro administrativo: la plataforma no ejecuta ni
 * consulta transferencias en Bitget. Nunca se borran; un registro erróneo se
 * ANULA con motivo (queda la trazabilidad).
 */
const DEPOSIT_SELECT = {
  id: true,
  amount: true,
  currency: true,
  depositedAt: true,
  reference: true,
  note: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
};
const shape = (d) => ({ ...d, amount: Number(d.amount) });

// ---------- ADMIN ----------
const listForAdmin = asyncHandler(async (req, res) => {
  const deposits = await prisma.qlcDeposit.findMany({
    where: { apiSubaccountId: req.params.id },
    orderBy: { depositedAt: 'desc' },
    select: DEPOSIT_SELECT,
  });
  res.json({ ok: true, deposits: deposits.map(shape) });
});

const createSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: 'Indica el monto del depósito.' }).positive('El monto debe ser mayor que 0.'),
  depositedAt: z.coerce.date({ invalid_type_error: 'La fecha del depósito no es válida.' }),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

const createDeposit = asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  if (data.depositedAt.getTime() > Date.now() + 10 * 60 * 1000) {
    throw ApiError.badRequest('La fecha del depósito no puede estar en el futuro.');
  }
  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: req.params.id } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  const deposit = await prisma.qlcDeposit.create({
    data: {
      apiSubaccountId: subaccount.id,
      amount: Math.round(data.amount * 100) / 100,
      depositedAt: data.depositedAt,
      reference: data.reference || null,
      note: data.note || null,
      createdByUserId: req.user.id,
    },
    select: DEPOSIT_SELECT,
  });
  const identifier = clientSubaccountLabel(subaccount);
  await notifyClient(subaccount.clientId, {
    title: 'Depósito de QLC registrado',
    message: `QLC registró un depósito de ${Number(deposit.amount)} ${deposit.currency}${identifier ? ` en tu subcuenta/API ${identifier}` : ''}. Puedes consultarlo en el historial de tu subcuenta.`,
    type: 'success',
    templateKey: 'qlc_deposit_registered',
    templateParams: { amount: String(Number(deposit.amount)), identifier, apiSubaccountId: subaccount.id },
  }).catch(() => {});
  res.status(201).json({ ok: true, deposit: shape(deposit) });
});

const voidSchema = z.object({ reason: z.string().trim().min(5, 'Indica el motivo de la anulación (mínimo 5 caracteres).').max(300) });

// ANULAR — nunca se elimina el registro; queda marcado con motivo y usuario.
const voidDeposit = asyncHandler(async (req, res) => {
  const { reason } = voidSchema.parse(req.body);
  const { count } = await prisma.qlcDeposit.updateMany({
    where: { id: req.params.depositId, voidedAt: null },
    data: { voidedAt: new Date(), voidedByUserId: req.user.id, voidReason: reason },
  });
  if (!count) throw ApiError.conflict('El depósito no existe o ya fue anulado.');
  const deposit = await prisma.qlcDeposit.findUnique({ where: { id: req.params.depositId }, select: DEPOSIT_SELECT });
  res.json({ ok: true, deposit: shape(deposit) });
});

// ---------- CLIENTE (solo sus subcuentas; nunca anulados) ----------
const listForClient = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: req.params.id, clientId: req.clientProfile.id }, select: { id: true } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  const deposits = await prisma.qlcDeposit.findMany({
    where: { apiSubaccountId: subaccount.id, voidedAt: null },
    orderBy: { depositedAt: 'desc' },
    select: { id: true, amount: true, currency: true, depositedAt: true, reference: true },
  });
  res.json({ ok: true, deposits: deposits.map(shape) });
});

module.exports = { listForAdmin, createDeposit, voidDeposit, listForClient };
