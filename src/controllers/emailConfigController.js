const { z } = require('zod');
const emailConfigService = require('../services/emailConfigService');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

function shapeStatus(status, userId) {
  return {
    ...status,
    isLockedByAnother: Boolean(status.configuredByUserId && status.configuredByUserId !== userId),
    isConfiguredByMe: Boolean(status.configuredByUserId && status.configuredByUserId === userId),
  };
}

const getConfig = asyncHandler(async (req, res) => {
  const status = await emailConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id) });
});

const updateSchema = z.object({
  gmailUser: z.string().email('Email inválido').optional(),
  gmailSenderName: z.string().max(100).optional(),
  gmailAppPassword: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
});

const updateConfig = asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  try {
    await emailConfigService.updateConfig(data, req.user.id);
  } catch (err) {
    if (err instanceof emailConfigService.EmailConfigLockedError) throw ApiError.forbidden(err.message);
    throw err;
  }
  const status = await emailConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id), message: 'Configuración de correo guardada correctamente.' });
});

const disconnect = asyncHandler(async (req, res) => {
  try {
    await emailConfigService.disconnect(req.user.id);
  } catch (err) {
    if (err instanceof emailConfigService.EmailConfigLockedError) throw ApiError.forbidden(err.message);
    throw err;
  }
  const status = await emailConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id), message: 'La configuración de correo fue desconectada.' });
});

// AUDITORÍA QLC PARTE 13 — envía un correo real de prueba (a la propia
// cuenta configurada, nunca a un cliente). El admin lo dispara a propósito
// desde el panel; nunca ocurre automáticamente.
const testConnection = asyncHandler(async (req, res) => {
  const result = await emailConfigService.testConnection();
  const status = await emailConfigService.getStatus();
  res.json({ ok: result.ok, message: result.message, config: shapeStatus(status, req.user.id) });
});

module.exports = { getConfig, updateConfig, disconnect, testConnection };
