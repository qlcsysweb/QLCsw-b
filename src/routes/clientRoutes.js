const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { resolveOwnClientProfile } = require('../middleware/clientAuth');
const { uploadDocument: uploadDocumentFile } = require('../middleware/upload');

const modelController = require('../controllers/modelController');
const profileController = require('../controllers/client/profileController');
const apiSubaccountController = require('../controllers/client/apiSubaccountController');
const contractController = require('../controllers/client/contractController');
const documentController = require('../controllers/client/documentController');
const paymentController = require('../controllers/client/paymentController');
const statementController = require('../controllers/client/statementController');
const walletController = require('../controllers/client/walletController');
const processController = require('../controllers/processController');
const supportController = require('../controllers/client/supportController');
const chatController = require('../controllers/client/chatController');
const appointmentController = require('../controllers/client/appointmentController');
const notificationController = require('../controllers/client/notificationController');
const platformSettingsController = require('../controllers/platformSettingsController');
const capitalIncreaseController = require('../controllers/client/capitalIncreaseController');

const router = Router();

// Todas las rutas del portal cliente: autenticado + rol CLIENT + su propio ClientProfile resuelto
router.use(requireAuth, requireRole('CLIENT'), resolveOwnClientProfile);

// Perfil / Dashboard
router.get('/me', profileController.getMe);
router.get('/dashboard', profileController.getDashboard);

// CORRECCIÓN 7 — Invitación para aumento de saldo operativo (solo lectura +
// aceptar/rechazar/marcar como leído — el cliente nunca crea/modifica
// invitaciones ni distribuciones). Ownership siempre vía req.clientProfile.id.
router.get('/capital-increase', capitalIncreaseController.getMine);
router.post('/capital-increase/invitations/:id/accept', capitalIncreaseController.acceptInvitation);
router.post('/capital-increase/invitations/:id/reject', capitalIncreaseController.rejectInvitation);
router.post('/capital-increase/requests/:id/mark-read', capitalIncreaseController.markInstructionsRead);

// Modelos de participación (lectura pública, ya activos)
router.get('/models', modelController.listModelsPublic);

// Subcuentas / API (CORRECCIÓN 11) — hasta 20 por cliente
router.get('/api-subaccounts', apiSubaccountController.listMine);
router.get('/api-subaccounts/:id', apiSubaccountController.getMine);
router.patch('/api-subaccounts/:id', apiSubaccountController.updateMine);
router.post('/api-subaccounts/:id/report-capital-ready', apiSubaccountController.reportCapitalReady);
router.post('/api-subaccounts/:id/model', apiSubaccountController.selectModel);
router.post('/api-subaccounts/:id/model/confirm', apiSubaccountController.confirmModel);

// Proceso de activación (solo lectura) — por subcuenta
router.get('/api-subaccounts/:apiSubaccountId/process', processController.getProcess);

// Contrato — por subcuenta
router.get('/api-subaccounts/:apiSubaccountId/contract', contractController.getContract);
router.post(
  '/api-subaccounts/:apiSubaccountId/contract/signed',
  uploadDocumentFile.single('file'),
  contractController.uploadSignedContract
);
router.get('/contract/:id/download/:variant', contractController.downloadContractFile);

// Documentos de identidad (a nivel cliente — REVERSIÓN A: bloqueados por defecto)
router.get('/documents', documentController.listDocuments);
router.post('/documents', uploadDocumentFile.single('file'), documentController.uploadDocument);
router.get('/documents/:id/download', documentController.downloadDocument);
router.delete('/documents/:id', documentController.deleteDocument);

// Pagos — por subcuenta
router.get('/payment-config', paymentController.getPaymentConfig);
router.get('/api-subaccounts/:apiSubaccountId/payment-reports', paymentController.listPaymentReports);
router.post(
  '/api-subaccounts/:apiSubaccountId/payment-reports',
  uploadDocumentFile.single('file'),
  paymentController.createPaymentReport
);
router.get('/payment-reports/:id/proof', paymentController.downloadPaymentProof);

// Estados de cuenta (CORRECCIÓN 14) — por subcuenta
router.get('/api-subaccounts/:apiSubaccountId/statements', statementController.listStatements);
router.get('/statements/:id/download', statementController.downloadStatementFile);
// CORRECCIÓN 5: solo lectura — el cliente nunca puede subir/modificar
// evidencia, solo verla (descarga vía /client/documents/:id/download).
router.get('/statements/:id/evidence', statementController.listStatementEvidence);

// Wallet personal (CORRECCIÓN 28)
router.get('/wallet', walletController.getWallet);
router.patch('/wallet', walletController.updateWallet);

// Liga hacia la plataforma externa (CORRECCIÓN 10) — solo lectura para el cliente
router.get('/platform-link', platformSettingsController.getPlatformLinkForClient);

// Guía de uso (CORRECCIÓN 27) — la del rol CLIENT únicamente
router.get('/guide', platformSettingsController.downloadMyGuide);

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
