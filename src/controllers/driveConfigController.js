const { z } = require('zod');
const driveConfigService = require('../services/driveConfigService');
const asyncHandler = require('../utils/asyncHandler');

// Cualquier admin puede editar o desconectar la configuración — el único
// dato relevante es informativo: quién la guardó por última vez.
function shapeStatus(status, userId) {
  return {
    ...status,
    isLockedByAnother: false,
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
  await driveConfigService.updateConfig(data, req.user.id);
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id), message: 'Configuración de Google Drive guardada correctamente.' });
});

const disconnect = asyncHandler(async (req, res) => {
  await driveConfigService.disconnect(req.user.id);
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
