const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const modelController = require('../controllers/modelController');
const contentController = require('../controllers/contentController');
const faqController = require('../controllers/faqController');
const trackRecordController = require('../controllers/trackRecordController');
const prospectController = require('../controllers/prospectController');
const appointmentController = require('../controllers/appointmentController');
const emailConfigController = require('../controllers/emailConfigController');
const driveConfigController = require('../controllers/driveConfigController');
const paymentController = require('../controllers/paymentController');
const affiliateController = require('../controllers/affiliateController');
const { cachedPublic, cachedPublicFor } = require('../utils/publicCache');

const router = Router();

const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Datos del sitio público: servidos desde caché en memoria (utils/publicCache)
// — NeonDB solo se consulta al vencer la caché o tras un cambio de un admin.
// Los TEXTOS del sitio ya no vienen de aquí: viven en el código del frontend
// (src/content/publicContent.js); /content se conserva solo por compatibilidad.
router.get('/models', cachedPublic, modelController.listModelsPublic);
router.get('/content', cachedPublic, contentController.listContentPublic);
router.get('/media', cachedPublic, contentController.listMediaPublic);
router.get('/media/logo', cachedPublic, contentController.getActiveLogo);
router.get('/faq', cachedPublic, faqController.listFaqPublic);
router.get('/track-record', cachedPublic, trackRecordController.getTrackRecordPublic);
// UID de recepción Bitget de QLC para el modal informativo de ingreso — solo
// ese dato (el mismo que QLC publica a sus clientes), nada más de la config.
router.get('/payment-info', cachedPublic, paymentController.getPublicReceiveUid);

// REGISTRO POR INVITACIÓN — valida un código de afiliado (límite estricto
// para que no se puedan enumerar códigos por fuerza bruta).
const affiliateValidateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
router.get('/affiliate/validate', affiliateValidateLimiter, affiliateController.validateAffiliateCode);
// Reparto vigente de la ganancia (cliente / QLC / promotor afiliador) para el modelo de participación.
router.get('/affiliate/distribution', cachedPublicFor(15 * 60 * 1000), affiliateController.getPublicDistribution);

// Formulario "Solicitar información" / Registro
router.post('/prospects', publicFormLimiter, prospectController.createProspect);

// Disponibilidad y solicitud de citas para prospectos
router.get('/availability', appointmentController.listAvailability);
router.post('/appointments', publicFormLimiter, appointmentController.createAppointment);

// Callback de Google OAuth2 para Gmail API (Admin → Configuración → Correo).
// Fuera de requireAuth a propósito: Google llega aquí con una navegación
// normal del navegador (redirect), no con un XHR autenticado de nuestra API.
// La identidad del admin y la protección CSRF viajan en el "state" firmado
// (ver emailConfigService.startOAuth/completeOAuth) — nunca en la sesión.
router.get('/email-config/oauth/callback', emailConfigController.oauthCallback);

// Callback de Google OAuth2 para Google Drive (Admin → Configuración →
// Google Drive) — mismo motivo que el callback de correo: llega como
// navegación normal del navegador, nunca con un XHR autenticado.
router.get('/drive-config/oauth/callback', driveConfigController.oauthCallback);

module.exports = router;
