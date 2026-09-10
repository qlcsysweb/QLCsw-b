const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { encrypt, decrypt } = require('../utils/crypto');
const { notifyClient } = require('../utils/notify');

const PROCESS_CONDITION_TYPES = ['CONTRACT', 'FUNDS', 'PAYMENT', 'API', 'ACTIVATION'];
// CORRECCIÓN 11: hasta 20 subcuentas/API por cliente. Se aplica aquí (no
// hay forma nativa de limitarlo en Prisma/Postgres para este caso).
const MAX_SUBACCOUNTS_PER_CLIENT = 20;

// CORRECCIÓN 11/16: cada subcuenta nace con su propio proceso de
// activación (5 condiciones) — igual que antes nacía a nivel cliente.
const createSubaccountSchema = z.object({
  identifier: z.string().min(1).optional(),
  requiredCapital: z.number().positive().optional(),
});

const createSubaccount = asyncHandler(async (req, res) => {
  const data = createSubaccountSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const count = await prisma.apiSubaccount.count({ where: { clientId: client.id } });
  if (count >= MAX_SUBACCOUNTS_PER_CLIENT) {
    throw ApiError.conflict(`Este cliente ya tiene el máximo de ${MAX_SUBACCOUNTS_PER_CLIENT} subcuentas/API.`);
  }

  if (data.identifier) {
    const existingIdentifier = await prisma.apiSubaccount.findUnique({ where: { identifier: data.identifier } });
    if (existingIdentifier) throw ApiError.conflict('Ese identificador ya está en uso por otra subcuenta.');
  }

  const nextSlot = count + 1;
  const subaccount = await prisma.apiSubaccount.create({
    data: {
      clientId: client.id,
      slotIndex: nextSlot,
      identifier: data.identifier || null,
      requiredCapital: data.requiredCapital ?? null,
      updatedByUserId: req.user.id,
      process: {
        create: {
          conditions: { create: PROCESS_CONDITION_TYPES.map((type) => ({ type, status: 'PENDING' })) },
        },
      },
    },
    include: { process: { include: { conditions: true } } },
  });

  res.status(201).json({ ok: true, subaccount });
});

const updateSubaccountSchema = z.object({
  identifier: z.string().min(1).nullable().optional(),
  exchangeName: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
  apiPassphrase: z.string().min(1).optional(),
  status: z.enum(['CONECTADA', 'DESCONECTADA', 'PENDIENTE']).optional(),
  requiredCapital: z.number().positive().nullable().optional(),
  notes: z.string().optional(),
});

const updateSubaccount = asyncHandler(async (req, res) => {
  const data = updateSubaccountSchema.parse(req.body);
  const existing = await prisma.apiSubaccount.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');

  if (data.identifier && data.identifier !== existing.identifier) {
    const clash = await prisma.apiSubaccount.findUnique({ where: { identifier: data.identifier } });
    if (clash) throw ApiError.conflict('Ese identificador ya está en uso por otra subcuenta.');
  }

  const statusChanged = data.status && data.status !== existing.status;

  const updated = await prisma.apiSubaccount.update({
    where: { id: req.params.id },
    data: {
      ...(data.identifier !== undefined ? { identifier: data.identifier } : {}),
      ...(data.exchangeName ? { exchangeName: data.exchangeName } : {}),
      ...(data.apiKey ? { apiKeyEncrypted: encrypt(data.apiKey) } : {}),
      ...(data.apiSecret ? { apiSecretEncrypted: encrypt(data.apiSecret) } : {}),
      ...(data.apiPassphrase ? { apiPassphraseEncrypted: encrypt(data.apiPassphrase) } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.requiredCapital !== undefined ? { requiredCapital: data.requiredCapital } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(statusChanged && data.status === 'DESCONECTADA' ? { disconnectedAt: new Date() } : {}),
      ...(statusChanged && data.status === 'CONECTADA' ? { reconnectedAt: new Date() } : {}),
      updatedByUserId: req.user.id,
    },
  });

  if (statusChanged) {
    // CORRECCIÓN 25: historial detallado de conexión/desconexión.
    await prisma.apiConnectionEvent.create({
      data: {
        apiSubaccountId: updated.id,
        eventType: data.status === 'CONECTADA' ? 'RECONNECTED' : 'DISCONNECTED',
      },
    });

    if (updated.status === 'CONECTADA') {
      const process = await prisma.process.findUnique({ where: { apiSubaccountId: updated.id } });
      if (process) {
        await prisma.processCondition.update({
          where: { processId_type: { processId: process.id, type: 'API' } },
          data: { status: 'CONFIRMED' },
        });
      }
    }

    await notifyClient(existing.clientId, {
      title: 'Actualización de tu conexión API',
      message: `Estado de tu conexión API${updated.identifier ? ` (${updated.identifier})` : ''}: ${updated.status}`,
      type: updated.status === 'CONECTADA' ? 'success' : 'info',
      templateKey: 'api_connection_status_updated',
      templateParams: { status: updated.status, identifier: updated.identifier },
    });
  }

  res.json({
    ok: true,
    subaccount: {
      ...updated,
      apiKeyEncrypted: undefined,
      apiSecretEncrypted: undefined,
      apiPassphraseEncrypted: undefined,
      hasApiKey: Boolean(updated.apiKeyEncrypted),
      hasApiSecret: Boolean(updated.apiSecretEncrypted),
      hasApiPassphrase: Boolean(updated.apiPassphraseEncrypted),
    },
  });
});

// El admin puede visualizar y copiar la API Key/Secret/Passphrase reales
// (alcance §8/CORRECCIÓN 10) — se descifra SOLO aquí, nunca en listados.
const getSubaccountSecrets = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: req.params.id } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  res.json({
    ok: true,
    secrets: {
      apiKey: subaccount.apiKeyEncrypted ? decrypt(subaccount.apiKeyEncrypted) : null,
      apiSecret: subaccount.apiSecretEncrypted ? decrypt(subaccount.apiSecretEncrypted) : null,
      apiPassphrase: subaccount.apiPassphraseEncrypted ? decrypt(subaccount.apiPassphraseEncrypted) : null,
    },
  });
});

module.exports = { createSubaccount, updateSubaccount, getSubaccountSecrets, MAX_SUBACCOUNTS_PER_CLIENT };
