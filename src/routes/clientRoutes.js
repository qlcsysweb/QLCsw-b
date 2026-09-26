const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { resolveOwnClientProfile } = require('../middleware/clientAuth');
const { uploadDocument: uploadDocumentFile, singleCaseFile } = require('../middleware/upload');

const modelController = require('../controllers/modelController');
const profileController = require('../controllers/client/profileController');
const apiSubaccountController = require('../controllers/client/apiSubaccountController');
const documentController = require('../controllers/client/documentController');
const paymentController = require('../controllers/client/paymentController');
const statementController = require('../controllers/client/statementController');
const processController = require('../controllers/processController');
const supportController = require('../controllers/client/supportController');
const chatController = require('../controllers/client/chatController');
const appointmentController = require('../controllers/client/appointmentController');
const notificationController = require('../controllers/client/notificationController');
const messageController = require('../controllers/client/messageController');
const platformSettingsController = require('../controllers/platformSettingsController');
const guideController = require('../controllers/client/guideController');
const processStepController = require('../controllers/processStepController');

const router = Router();

// Todas las rutas del portal cliente: autenticado + rol CLIENT + su propio ClientProfile resuelto
router.use(requireAuth, requireRole('CLIENT'), resolveOwnClientProfile);

// Perfil / Dashboard
router.get('/me', profileController.getMe);
router.get('/dashboard', profileController.getDashboard);

// Modelos de participación (lectura pública, ya activos)
router.get('/models', modelController.listModelsPublic);

// Subcuentas / API — GESTIÓN DINÁMICA: el cliente nace con solo su cuenta
// PRINCIPAL; toda subcuenta adicional (hasta 20) y toda desactivación pasan
// por una solicitud que un admin aprueba o rechaza. Nunca se elimina.
router.get('/api-subaccounts', apiSubaccountController.listMine);
router.get('/api-subaccounts/requests', apiSubaccountController.listMyRequests);
router.post('/api-subaccounts/requests', apiSubaccountController.requestNewSubaccount);
router.post('/api-subaccounts/:id/requests/deactivate', apiSubaccountController.requestDeactivateSubaccount);
router.get('/api-subaccounts/:id', apiSubaccountController.getMine);
router.patch('/api-subaccounts/:id', apiSubaccountController.updateMine);
router.post('/api-subaccounts/:id/report-capital-ready', apiSubaccountController.reportCapitalReady);
// CORREGIR.xlsx CLIENTE 13 — reporte real de distribución de capital
router.get('/api-subaccounts/:id/capital-distribution-reports', apiSubaccountController.listCapitalDistributionReports);
router.post('/api-subaccounts/:id/capital-distribution-reports', apiSubaccountController.reportCapitalDistribution);
router.post('/api-subaccounts/:id/model', apiSubaccountController.selectModel);
router.post('/api-subaccounts/:id/model/confirm', apiSubaccountController.confirmModel);

// Proceso de activación (solo lectura) — por subcuenta
router.get('/api-subaccounts/:apiSubaccountId/process', processController.getProcess);

// Documentos de identidad (a nivel cliente — REVERSIÓN A: bloqueados por defecto)
router.get('/documents', documentController.listDocuments);
router.post('/documents', uploadDocumentFile.single('file'), documentController.uploadDocument);
router.get('/documents/:id/download', documentController.downloadDocument);
router.delete('/documents/:id', documentController.deleteDocument);
router.post('/documents/:id/correction', uploadDocumentFile.single('file'), documentController.correctDocument);

// Pagos / Garantía — Transferencia interna Bitget, por subcuenta. El
// cliente solo reporta número de orden + fecha/hora de la transacción.
router.get('/api-subaccounts/:apiSubaccountId/payment-data', paymentController.getSubaccountPaymentData);
router.get('/api-subaccounts/:apiSubaccountId/payment-reports', paymentController.listPaymentReports);
router.post('/api-subaccounts/:apiSubaccountId/payment-reports', paymentController.createPaymentReport);
router.get('/payment-reports/:id/proof', paymentController.downloadPaymentProof);

// Estado de cuenta — estado actual por subcuenta (NO GENERADO / PENDIENTE
// DE PAGO / PAGADO / VENCIDO SIN PAGAR) y descarga del PDF.
router.get('/api-subaccounts/:apiSubaccountId/statements', statementController.listStatements);
router.get('/statements/:id/download', statementController.downloadStatementFile);

// Liga hacia la plataforma externa (CORRECCIÓN 10) — solo lectura para el cliente
router.get('/platform-link', platformSettingsController.getPlatformLinkForClient);

// Guía de uso — PDF (CORRECCIÓN 27, se conserva) + biblioteca HTML
// (CORRECCIÓN 1/6/20/21, fuente principal editable desde ADMIN).
router.get('/guide', platformSettingsController.downloadMyGuide);
router.get('/guides', guideController.listGuides);

// Soporte
router.get('/support-cases', supportController.listSupportCases);
router.post('/support-cases', supportController.createSupportCase);
router.get('/support-cases/:id/messages', supportController.listCaseMessages);
router.post('/support-cases/:id/messages', supportController.sendCaseMessage);
router.get('/support-cases/:id/files', supportController.listCaseFiles);
router.post('/support-cases/:id/files', singleCaseFile, supportController.uploadCaseFile);
router.get('/support-cases/:id/files/:fileId/download', supportController.downloadCaseFile);

// Chat
router.get('/chat-sessions', chatController.listChatSessions);
// CORREGIR(2).xlsx CLIENTE 28 — permite al botón "Entrar al chat" de la cita
// resolver directamente la sesión asociada, sin que el cliente tenga que
// buscarla manualmente en Soporte.
router.get('/appointments/:appointmentId/chat-session', chatController.getSessionByAppointment);
router.get('/chat/:id', chatController.getSession);
router.post('/chat/:id/start', chatController.startSession);
router.post('/chat/:id/messages', chatController.sendMessage);
router.get('/chat/:id/pdf', chatController.downloadSessionPdf);

// Citas
router.get('/availability', appointmentController.listAvailability);
router.get('/appointments/available-slots', appointmentController.listAvailableSlots);
router.get('/appointments', appointmentController.listAppointments);
router.post('/appointments', appointmentController.createAppointment);

// CORREGIR.xlsx CLIENTE 07 — "Tu proceso paso a paso" (solo lectura, CMS editable desde ADMIN)
router.get('/process-steps', processStepController.listStepsPublic);

// Notificaciones
router.get('/notifications', notificationController.listNotifications);
router.patch('/notifications/:id/read', notificationController.markAsRead);
router.post('/notifications/read-all', notificationController.markAllAsRead);

// Mensajería interna (buzón admin↔cliente) — distinta del chat de citas y
// de los casos de soporte.
router.get('/messages', messageController.listMyMessages);
router.post('/messages', messageController.sendMessage);
router.post('/messages/read-all', messageController.markAllRead);

module.exports = router;
