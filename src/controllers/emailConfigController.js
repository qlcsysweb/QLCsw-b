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
  authMethod: z.enum(['APP_PASSWORD', 'OAUTH2']).optional(),
  googleClientId: z.string().min(1).optional(),
  googleClientSecret: z.string().min(1).optional(),
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

// Paso 1 del OAuth2: devuelve la URL de consentimiento de Google para que el
// frontend navegue ahí. Requiere sesión de admin (igual que el resto del
// panel) — la propia cuenta de Google que complete el consentimiento se
// valida después, en el callback, contra el correo ya guardado.
const oauthStart = asyncHandler(async (req, res) => {
  try {
    const { url } = await emailConfigService.startOAuth(req.user.id);
    res.json({ ok: true, url });
  } catch (err) {
    if (err instanceof emailConfigService.EmailConfigLockedError) throw ApiError.forbidden(err.message);
    if (err instanceof emailConfigService.OAuthConfigError) throw ApiError.badRequest(err.message);
    throw err;
  }
});

// Paso 2: Google redirige aquí (navegación normal del navegador, no un XHR
// autenticado) con ?code=&state=. Por eso vive fuera del middleware de
// autenticación (ver routes/publicRoutes.js) — la identidad del admin y la
// protección CSRF viajan dentro del "state" firmado (ver startOAuth). Nunca
// devuelve JSON: siempre redirige de vuelta al panel con el resultado.
const oauthCallback = async (req, res) => {
  const redirectBase = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '');
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(
      `${redirectBase}/admin/settings/email?oauth=error&reason=${encodeURIComponent('Autorización cancelada en Google: ' + error)}`
    );
    return;
  }

  try {
    const result = await emailConfigService.completeOAuth({ code, state });
    res.redirect(`${redirectBase}/admin/settings/email?oauth=success&email=${encodeURIComponent(result.email)}`);
  } catch (err) {
    res.redirect(
      `${redirectBase}/admin/settings/email?oauth=error&reason=${encodeURIComponent(err.message || 'Error desconocido al conectar con Google.')}`
    );
  }
};

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

module.exports = { getConfig, updateConfig, disconnect, testConnection, oauthStart, oauthCallback };
