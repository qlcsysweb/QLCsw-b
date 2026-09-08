const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { encrypt } = require('../utils/crypto');
const { notifyClient } = require('../utils/notify');

const getApiConnection = asyncHandler(async (req, res) => {
  const connection = await prisma.apiConnection.findUnique({ where: { clientId: req.params.clientId } });
  if (!connection) throw ApiError.notFound('Conexión API no encontrada');

  res.json({
    ok: true,
    connection: {
      id: connection.id,
      clientId: connection.clientId,
      exchangeName: connection.exchangeName,
      status: connection.status,
      notes: connection.notes,
      hasApiKey: Boolean(connection.apiKeyEncrypted),
      hasApiSecret: Boolean(connection.apiSecretEncrypted),
      updatedAt: connection.updatedAt,
    },
  });
});

const setApiConnectionSchema = z.object({
  exchangeName: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  status: z.enum(['CONECTADA', 'DESCONECTADA', 'PENDIENTE']).optional(),
  notes: z.string().optional(),
});

const setApiConnection = asyncHandler(async (req, res) => {
  const data = setApiConnectionSchema.parse(req.body);

  const existing = await prisma.apiConnection.findUnique({ where: { clientId: req.params.clientId } });
  if (!existing) throw ApiError.notFound('Conexión API no encontrada');

  const updated = await prisma.apiConnection.update({
    where: { clientId: req.params.clientId },
    data: {
      ...(data.exchangeName ? { exchangeName: data.exchangeName } : {}),
      ...(data.apiKey ? { apiKeyEncrypted: encrypt(data.apiKey) } : {}),
      ...(data.apiSecret ? { apiSecretEncrypted: encrypt(data.apiSecret) } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      updatedByUserId: req.user.id,
    },
  });

  if (updated.status === 'CONECTADA') {
    const process = await prisma.process.findUnique({ where: { clientId: req.params.clientId } });
    if (process) {
      await prisma.processCondition.update({
        where: { processId_type: { processId: process.id, type: 'API' } },
        data: { status: 'CONFIRMED' },
      });
    }
  }

  if (data.status) {
    await notifyClient(req.params.clientId, {
      title: 'Actualización de tu conexión API',
      message: `Estado de tu conexión API: ${updated.status}`,
      type: updated.status === 'CONECTADA' ? 'success' : 'info',
    });
  }

  res.json({
    ok: true,
    connection: {
      id: updated.id,
      clientId: updated.clientId,
      exchangeName: updated.exchangeName,
      status: updated.status,
      notes: updated.notes,
      hasApiKey: Boolean(updated.apiKeyEncrypted),
      hasApiSecret: Boolean(updated.apiSecretEncrypted),
      updatedAt: updated.updatedAt,
    },
  });
});

module.exports = { getApiConnection, setApiConnection };
