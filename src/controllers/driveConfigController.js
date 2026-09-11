const { z } = require('zod');
const driveConfigService = require('../services/driveConfigService');
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
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id) });
});

const updateSchema = z.object({
  rootFolderId: z.string().optional(),
  rootFolderName: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
  // CORRECCIÓN 7: credencial técnica configurable desde el panel — ambos
  // opcionales (dejar vacío conserva la credencial ya guardada).
  serviceAccountEmail: z.string().email('Email inválido').optional(),
  serviceAccountPrivateKey: z.string().min(1).optional(),
});

const updateConfig = asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  try {
    await driveConfigService.updateConfig(data, req.user.id);
  } catch (err) {
    if (err instanceof driveConfigService.DriveConfigLockedError) throw ApiError.forbidden(err.message);
    throw err;
  }
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id), message: 'Configuración de Google Drive guardada correctamente.' });
});

const disconnect = asyncHandler(async (req, res) => {
  try {
    await driveConfigService.disconnect(req.user.id);
  } catch (err) {
    if (err instanceof driveConfigService.DriveConfigLockedError) throw ApiError.forbidden(err.message);
    throw err;
  }
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id), message: 'Google Drive fue desconectado.' });
});

const testConnection = asyncHandler(async (req, res) => {
  const result = await driveConfigService.testConnection();
  const status = await driveConfigService.getStatus();
  res.json({
    ok: result.ok,
    message: result.message,
    capabilities: result.capabilities,
    folderName: result.folderName,
    config: shapeStatus(status, req.user.id),
  });
});

module.exports = { getConfig, updateConfig, disconnect, testConnection };
