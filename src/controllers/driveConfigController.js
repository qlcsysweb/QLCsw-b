const { z } = require('zod');
const driveConfigService = require('../services/driveConfigService');
const asyncHandler = require('../utils/asyncHandler');

const getConfig = asyncHandler(async (req, res) => {
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: status });
});

const updateSchema = z.object({
  rootFolderId: z.string().optional(),
  rootFolderName: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
});

const updateConfig = asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  await driveConfigService.updateConfig(data, req.user.id);
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: status, message: 'Configuración de Google Drive guardada correctamente.' });
});

const disconnect = asyncHandler(async (req, res) => {
  await driveConfigService.disconnect(req.user.id);
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: status, message: 'Google Drive fue desconectado.' });
});

const testConnection = asyncHandler(async (req, res) => {
  const result = await driveConfigService.testConnection();
  const status = await driveConfigService.getStatus();
  res.json({ ok: result.ok, message: result.message, capabilities: result.capabilities, folderName: result.folderName, config: status });
});

module.exports = { getConfig, updateConfig, disconnect, testConnection };
