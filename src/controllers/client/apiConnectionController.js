const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { encrypt } = require('../../utils/crypto');

// El cliente puede ver el estado y SI ya registró su API Key/Secret, pero
// nunca el valor real (solo lo escribe, no lo vuelve a leer) — igual que un
// campo de contraseña. El estado rojo/verde es exclusivamente administrativo.
const getApiConnection = asyncHandler(async (req, res) => {
  const connection = await prisma.apiConnection.findUnique({
    where: { clientId: req.clientProfile.id },
  });
  if (!connection) throw ApiError.notFound('Conexión API no encontrada');

  res.json({
    ok: true,
    connection: {
      exchangeName: connection.exchangeName,
      status: connection.status,
      hasApiKey: Boolean(connection.apiKeyEncrypted),
      hasApiSecret: Boolean(connection.apiSecretEncrypted),
      updatedAt: connection.updatedAt,
    },
  });
});

const setApiConnectionSchema = z.object({
  exchangeName: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
});

// El cliente introduce su propia API Key/Secret (alcance §8) — nunca puede
// cambiar el estado de conexión, que permanece bajo control administrativo.
const setApiConnection = asyncHandler(async (req, res) => {
  const data = setApiConnectionSchema.parse(req.body);
  if (!data.exchangeName && !data.apiKey && !data.apiSecret) {
    throw ApiError.badRequest('Debes indicar al menos un dato para actualizar');
  }

  const existing = await prisma.apiConnection.findUnique({ where: { clientId: req.clientProfile.id } });
  if (!existing) throw ApiError.notFound('Conexión API no encontrada');

  const updated = await prisma.apiConnection.update({
    where: { clientId: req.clientProfile.id },
    data: {
      ...(data.exchangeName ? { exchangeName: data.exchangeName } : {}),
      ...(data.apiKey ? { apiKeyEncrypted: encrypt(data.apiKey) } : {}),
      ...(data.apiSecret ? { apiSecretEncrypted: encrypt(data.apiSecret) } : {}),
      updatedByUserId: req.user.id,
    },
  });

  res.json({
    ok: true,
    connection: {
      exchangeName: updated.exchangeName,
      status: updated.status,
      hasApiKey: Boolean(updated.apiKeyEncrypted),
      hasApiSecret: Boolean(updated.apiSecretEncrypted),
      updatedAt: updated.updatedAt,
    },
  });
});

module.exports = { getApiConnection, setApiConnection };
