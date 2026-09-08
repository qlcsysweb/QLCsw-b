const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadDocument: uploadDocumentFile, uploadImage, uploadMedia } = require('../middleware/upload');

const dashboardController = require('../controllers/dashboardController');
const clientController = require('../controllers/clientController');
const processController = require('../controllers/processController');
const modelController = require('../controllers/modelController');
const contentController = require('../controllers/contentController');
const faqController = require('../controllers/faqController');
const trackRecordController = require('../controllers/trackRecordController');
const adminController = require('../controllers/adminController');
const contractController = require('../controllers/contractController');
const documentController = require('../controllers/documentController');
const paymentController = require('../controllers/paymentController');
const appointmentController = require('../controllers/appointmentController');
const supportController = require('../controllers/supportController');
const chatController = require('../controllers/chatController');
const prospectController = require('../controllers/prospectController');
const apiConnectionController = require('../controllers/apiConnectionController');
const driveConfigController = require('../controllers/driveConfigController');
const mediaController = require('../controllers/mediaController');

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// Dashboard
router.get('/dashboard', dashboardController.getSummary);

// Clients
router.get('/clients', clientController.listClients);
router.post('/clients', clientController.createClient);
router.get('/clients/:id', clientController.getClient);
router.patch('/clients/:id', clientController.updateClient);
router.patch('/clients/:id/active', clientController.setClientActive);
router.patch('/clients/:id/model', clientController.selectClientModel);

// Process / activation
router.get('/clients/:clientId/process', processController.getProcess);
router.patch('/clients/:clientId/process/:type', processController.updateCondition);
router.post('/clients/:clientId/activate', processController.activateClient);
router.post('/clients/:clientId/deactivate', processController.deactivateClient);

// Models
router.get('/models', modelController.listModelsAdmin);
router.patch('/models/:id', modelController.updateModel);

// Public content
router.get('/content', contentController.listContentAdmin);
router.put('/content', contentController.upsertContent);
router.put('/content/bulk', contentController.bulkUpsertContent);

// FAQ
router.get('/faq', faqController.listFaqAdmin);
router.post('/faq', faqController.createFaq);
router.patch('/faq/:id', faqController.updateFaq);
router.delete('/faq/:id', faqController.deleteFaq);

// Track record
router.get('/track-record', trackRecordController.getTrackRecordAdmin);
router.patch('/track-record/:id', trackRecordController.updateTrackRecord);

// Administrators (max 3)
router.get('/admins', adminController.listAdmins);
router.post('/admins', adminController.createAdmin);
router.patch('/admins/:id', adminController.updateAdmin);

// Contracts (documentos → Google Drive)
router.get('/clients/:clientId/contracts', contractController.listContractsByClient);
router.post(
  '/clients/:clientId/contracts',
  uploadDocumentFile.single('file'),
  contractController.uploadOriginalContract
);
router.post(
  '/contracts/:id/signed',
  uploadDocumentFile.single('file'),
  contractController.uploadSignedContract
);
router.get('/contracts/:id/download/:variant', contractController.downloadContractFile);
router.patch('/contracts/:id/status', contractController.updateContractStatus);
router.post('/contracts/:id/reset-signed', contractController.resetSignedContract);
router.delete('/contracts/:id', contractController.deleteContract);

// Documents (documentos → Google Drive)
router.get('/clients/:clientId/documents', documentController.listDocumentsByClient);
router.post(
  '/clients/:clientId/documents',
  uploadDocumentFile.single('file'),
  documentController.uploadDocument
);
router.get('/documents/:id/download', documentController.downloadDocument);
router.delete('/documents/:id', documentController.deleteDocument);

// Payments (QR → Cloudinary imagen, comprobante → Google Drive documento)
router.get('/payment-config', paymentController.getPaymentConfig);
router.put('/payment-config', paymentController.updatePaymentConfig);
router.post('/payment-config/qr', uploadImage.single('file'), paymentController.uploadPaymentQr);
router.get('/payment-reports', paymentController.listPaymentReports);
router.get('/payment-reports/:id/proof', paymentController.downloadPaymentProof);
router.patch('/payment-reports/:id', paymentController.reviewPaymentReport);

// Appointments
router.get('/availability', appointmentController.listAvailability);
router.put('/availability', appointmentController.setAvailability);
router.get('/appointments', appointmentController.listAppointments);
router.patch('/appointments/:id/status', appointmentController.updateAppointmentStatus);

// Support / Chat
router.get('/support-cases', supportController.listSupportCases);
router.patch('/support-cases/:id', supportController.updateSupportCase);
router.get('/chat-sessions', chatController.listSessions);
router.get('/chat/:id', chatController.getSession);
router.post('/chat/:id/start', chatController.startSession);
router.post('/chat/:id/messages', chatController.sendMessage);
router.post('/chat/:id/close', chatController.closeSession);

// Prospects
router.get('/prospects', prospectController.listProspects);
router.patch('/prospects/:id', prospectController.updateProspectStatus);

// API Connection
router.get('/clients/:clientId/api-connection', apiConnectionController.getApiConnection);
router.patch('/clients/:clientId/api-connection', apiConnectionController.setApiConnection);

// Configuración de Google Drive (Admin → Configuración → Google Drive)
router.get('/drive-config', driveConfigController.getConfig);
router.put('/drive-config', driveConfigController.updateConfig);
router.post('/drive-config/test', driveConfigController.testConnection);
router.post('/drive-config/disconnect', driveConfigController.disconnect);

// Multimedia del sitio público (imágenes/video, incluye el logo)
router.get('/media', mediaController.listMediaAdmin);
router.post('/media', uploadMedia.single('file'), mediaController.createMedia);
router.patch('/media/:id', mediaController.updateMedia);
router.post('/media/:id/replace', uploadMedia.single('file'), mediaController.replaceMediaFile);
router.delete('/media/:id', mediaController.deleteMedia);

module.exports = router;
