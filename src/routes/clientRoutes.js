const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { resolveOwnClientProfile } = require('../middleware/clientAuth');
const { uploadDocument: uploadDocumentFile } = require('../middleware/upload');

const modelController = require('../controllers/modelController');
const profileController = require('../controllers/client/profileController');
const contractController = require('../controllers/client/contractController');
const documentController = require('../controllers/client/documentController');
const paymentController = require('../controllers/client/paymentController');
const supportController = require('../controllers/client/supportController');
const chatController = require('../controllers/client/chatController');
const appointmentController = require('../controllers/client/appointmentController');
const apiConnectionController = require('../controllers/client/apiConnectionController');
const notificationController = require('../controllers/client/notificationController');

const router = Router();

// Todas las rutas del portal cliente: autenticado + rol CLIENT + su propio ClientProfile resuelto
router.use(requireAuth, requireRole('CLIENT'), resolveOwnClientProfile);

// Perfil / Dashboard
router.get('/me', profileController.getMe);
router.patch('/me', profileController.updateMe);
router.get('/dashboard', profileController.getDashboard);

// Modelos (lectura pública + selección propia)
router.get('/models', modelController.listModelsPublic);
router.patch('/model', profileController.selectModel);

// Proceso (solo lectura)
router.get('/process', profileController.getProcess);

// Contrato
router.get('/contract', contractController.getContract);
router.post('/contract/signed', uploadDocumentFile.single('file'), contractController.uploadSignedContract);
router.get('/contract/:id/download/:variant', contractController.downloadContractFile);

// Documentos
router.get('/documents', documentController.listDocuments);
router.post('/documents', uploadDocumentFile.single('file'), documentController.uploadDocument);
router.get('/documents/:id/download', documentController.downloadDocument);

// Pagos
router.get('/payment-config', paymentController.getPaymentConfig);
router.get('/payment-reports', paymentController.listPaymentReports);
router.post('/payment-reports', uploadDocumentFile.single('file'), paymentController.createPaymentReport);
router.get('/payment-reports/:id/proof', paymentController.downloadPaymentProof);

// Conexión API (solo lectura de estado)
router.get('/api-connection', apiConnectionController.getApiConnection);

// Soporte
router.get('/support-cases', supportController.listSupportCases);
router.post('/support-cases', supportController.createSupportCase);

// Chat
router.get('/chat-sessions', chatController.listChatSessions);
router.get('/chat/:id', chatController.getSession);
router.post('/chat/:id/start', chatController.startSession);
router.post('/chat/:id/messages', chatController.sendMessage);

// Citas
router.get('/availability', appointmentController.listAvailability);
router.get('/appointments', appointmentController.listAppointments);
router.post('/appointments', appointmentController.createAppointment);

// Notificaciones
router.get('/notifications', notificationController.listNotifications);
router.patch('/notifications/:id/read', notificationController.markAsRead);
router.post('/notifications/read-all', notificationController.markAllAsRead);

module.exports = router;
