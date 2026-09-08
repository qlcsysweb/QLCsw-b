const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const modelController = require('../controllers/modelController');
const contentController = require('../controllers/contentController');
const faqController = require('../controllers/faqController');
const trackRecordController = require('../controllers/trackRecordController');
const prospectController = require('../controllers/prospectController');
const appointmentController = require('../controllers/appointmentController');

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

module.exports = router;
