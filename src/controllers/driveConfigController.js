const { z } = require('zod');
const driveConfigService = require('../services/driveConfigService');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { extractDriveFolderId } = require('../utils/driveFolderId');

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
  googleClientId: z.string().min(1).optional(),
  googleClientSecret: z.string().min(1).optional(),
});

const updateConfig = asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);

  // El admin puede pegar el Folder ID "pelón" o la URL completa de Drive —
  // aquí se detecta y normaliza ANTES de guardar; en DB solo vive el ID.
  let detectedFolderId = null;
  if (data.rootFolderId !== undefined) {
    const trimmed = data.rootFolderId.trim();
    if (!trimmed) {
      data.rootFolderId = '';
    } else {
      const extracted = extractDriveFolderId(trimmed);
      if (!extracted) {
        throw ApiError.badRequest(
          'No se pudo reconocer un Folder ID válido en lo que pegaste. Pega el ID de la carpeta o su URL completa de Google Drive (por ejemplo: https://drive.google.com/drive/folders/TU_FOLDER_ID).'
        );
      }
      data.rootFolderId = extracted;
      detectedFolderId = extracted;
    }
  }

  await driveConfigService.updateConfig(data, req.user.id);
  const status = await driveConfigService.getStatus();
  res.json({
    ok: true,
    config: shapeStatus(status, req.user.id),
    message: detectedFolderId
      ? `Configuración de Google Drive guardada correctamente. Folder ID detectado: ${detectedFolderId}`
      : 'Configuración de Google Drive guardada correctamente.',
  });
});

// Paso 1 del OAuth2: devuelve la URL de consentimiento de Google.
const oauthStart = asyncHandler(async (req, res) => {
  try {
    const { url } = await driveConfigService.startOAuth(req.user.id);
    res.json({ ok: true, url });
  } catch (err) {
    if (err instanceof driveConfigService.OAuthConfigError) throw ApiError.badRequest(err.message);
    throw err;
  }
});

// Paso 2: Google redirige aquí (navegación normal del navegador, no un XHR
// autenticado) con ?code=&state=. Vive fuera del middleware de autenticación
// (ver routes/publicRoutes.js) — la identidad del admin viaja en el "state"
// firmado (ver startOAuth). Nunca devuelve JSON: siempre redirige al panel.
const oauthCallback = async (req, res) => {
  const redirectBase = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '');
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(
      `${redirectBase}/admin/settings/drive?oauth=error&reason=${encodeURIComponent('Autorización cancelada en Google: ' + error)}`
    );
    return;
  }

  try {
    const result = await driveConfigService.completeOAuth({ code, state });
    res.redirect(`${redirectBase}/admin/settings/drive?oauth=success&email=${encodeURIComponent(result.email)}`);
  } catch (err) {
    res.redirect(
      `${redirectBase}/admin/settings/drive?oauth=error&reason=${encodeURIComponent(err.message || 'Error desconocido al conectar con Google.')}`
    );
  }
};

const disconnect = asyncHandler(async (req, res) => {
  await driveConfigService.disconnect(req.user.id);
  const status = await driveConfigService.getStatus();
  res.json({ ok: true, config: shapeStatus(status, req.user.id), message: 'Google Drive fue desconectado.' });
});

// Prueba real contra Drive (verify + carpeta raíz). El admin la dispara a
// propósito desde el panel; nunca ocurre automáticamente. NOTA: esta función
// existe y queda lista, pero no se invoca en esta fase — las pruebas reales
// contra Google Drive requieren autorización explícita del usuario.
const testConnection = asyncHandler(async (req, res) => {
  const result = await driveConfigService.testConnection();
  const status = await driveConfigService.getStatus();
  res.json({ ok: result.ok, message: result.message, config: shapeStatus(status, req.user.id) });
});

module.exports = { getConfig, updateConfig, disconnect, testConnection, oauthStart, oauthCallback };
