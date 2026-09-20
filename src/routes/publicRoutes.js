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

const router = Router();

const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/models', modelController.listModelsPublic);
router.get('/content', contentController.listContentPublic);
router.get('/media', contentController.listMediaPublic);
router.get('/media/logo', contentController.getActiveLogo);
router.get('/faq', faqController.listFaqPublic);
router.get('/track-record', trackRecordController.getTrackRecordPublic);

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
