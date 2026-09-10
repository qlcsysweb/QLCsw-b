const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadDocument: uploadDocumentFile, uploadImage, uploadMedia } = require('../middleware/upload');

const dashboardController = require('../controllers/dashboardController');
const clientController = require('../controllers/clientController');
const apiSubaccountController = require('../controllers/apiSubaccountController');
const processController = require('../controllers/processController');
const modelController = require('../controllers/modelController');
const contentController = require('../controllers/contentController');
const faqController = require('../controllers/faqController');
const trackRecordController = require('../controllers/trackRecordController');
const adminController = require('../controllers/adminController');
const contractController = require('../controllers/contractController');
const documentController = require('../controllers/documentController');
const statementController = require('../controllers/statementController');
const paymentController = require('../controllers/paymentController');
const appointmentController = require('../controllers/appointmentController');
const supportController = require('../controllers/supportController');
const chatController = require('../controllers/chatController');
const prospectController = require('../controllers/prospectController');
const driveConfigController = require('../controllers/driveConfigController');
const mediaController = require('../controllers/mediaController');
const platformSettingsController = require('../controllers/platformSettingsController');
const capitalIncreaseController = require('../controllers/capitalIncreaseController');
const guideController = require('../controllers/guideController');

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
router.get('/clients/:id/wallet', clientController.getWallet);
router.delete('/clients/:id', clientController.deleteClient);

// CORRECCIÓN 7/8 — Invitación para aumento de saldo operativo (solo ADMIN
// crea/autoriza; la distribución entre subcuentas la realiza el CLIENTE —
// ver client/capitalIncreaseController.js).
router.get('/clients/:clientId/capital-increase', capitalIncreaseController.listForClient);
router.post('/clients/:clientId/capital-increase/invitations', capitalIncreaseController.createInvitation);
router.post('/capital-increase/requests/:requestId/authorize', capitalIncreaseController.authorizeRequest);

// Subcuentas / API (CORRECCIÓN 10/11/27) — 1 cuenta principal + 20
// subcuentas, creadas automáticamente al registrar/crear un cliente.
router.post('/clients/:clientId/api-subaccounts', apiSubaccountController.createSubaccount);
router.post('/clients/:clientId/api-subaccounts/ensure-all', apiSubaccountController.ensureSubaccounts);
router.patch('/api-subaccounts/:id', apiSubaccountController.updateSubaccount);
router.get('/api-subaccounts/:id/secrets', apiSubaccountController.getSubaccountSecrets);

// Process / activation — por subcuenta
router.get('/api-subaccounts/:apiSubaccountId/process', processController.getProcess);
router.patch('/api-subaccounts/:apiSubaccountId/process/:type', processController.updateCondition);
router.post('/api-subaccounts/:apiSubaccountId/activate', processController.activateSubaccount);
router.post('/api-subaccounts/:apiSubaccountId/deactivate', processController.deactivateSubaccount);

// Models (CORRECCIÓN 30 — CRUD completo, sin límite artificial)
router.get('/models', modelController.listModelsAdmin);
router.post('/models', modelController.createModel);
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

// Contracts (documentos → Google Drive) — por subcuenta
router.get('/api-subaccounts/:apiSubaccountId/contract', contractController.getContractBySubaccount);
router.post(
  '/api-subaccounts/:apiSubaccountId/contract',
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

// Documents (identidad del cliente → Google Drive)
router.get('/clients/:clientId/documents', documentController.listDocumentsByClient);
router.post(
  '/clients/:clientId/documents',
  uploadDocumentFile.single('file'),
  documentController.uploadDocument
);
router.get('/documents/:id/download', documentController.downloadDocument);
router.delete('/documents/:id', documentController.deleteDocument);
// REVERSIÓN A: única forma de que el cliente pueda eliminar/reemplazar un
// documento puntual — el admin lo habilita temporalmente.
router.patch('/documents/:id/unlock', documentController.setDocumentUnlock);

// Estados de cuenta (CORRECCIÓN 14) — por subcuenta
router.get('/api-subaccounts/:apiSubaccountId/statements', statementController.listStatements);
router.post('/api-subaccounts/:apiSubaccountId/statements', statementController.createStatement);
router.get('/statements/:id/download', statementController.downloadStatementFile);
// CORRECCIÓN 5: reenvío al cliente + evidencia documental (misma
// arquitectura de almacenamiento que el resto de documentos).
router.post('/statements/:id/send', statementController.sendStatementToClient);
router.get('/statements/:id/evidence', statementController.listStatementEvidence);
router.post(
  '/statements/:id/evidence',
  uploadDocumentFile.single('file'),
  statementController.uploadStatementEvidence
);

// Payments (QR → Cloudinary imagen, comprobante → Google Drive documento)
router.get('/payment-config', paymentController.getPaymentConfig);
router.put('/payment-config', paymentController.updatePaymentConfig);
router.post('/payment-config/qr', uploadImage.single('file'), paymentController.uploadPaymentQr);
router.get('/payment-reports', paymentController.listPaymentReports);
router.post(
  '/api-subaccounts/:apiSubaccountId/payment-reports',
  uploadDocumentFile.single('file'),
  paymentController.createPaymentReport
);
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

// Configuración de Google Drive (Admin → Configuración → Google Drive)
// CORRECCIÓN 24: bloqueada tras la primera configuración — solo quien la
// configuró puede editarla o desconectarla.
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

// Configuración de plataforma: liga externa (CORRECCIÓN 10)
router.get('/platform-settings', platformSettingsController.getPlatformSettingsAdmin);
router.put('/platform-settings', platformSettingsController.updatePlatformSettings);

// Guías de uso ADMIN/CLIENTE (CORRECCIÓN 27) — únicos PDFs en Cloudinary.
// El antiguo "PDF informativo" (CORRECCIÓN 4) fue eliminado por completo.
router.post('/platform-settings/guide/:role', uploadDocumentFile.single('file'), platformSettingsController.uploadGuide);
router.delete('/platform-settings/guide/:role', platformSettingsController.deleteGuide);
router.get('/guide', platformSettingsController.downloadMyGuide);

// CORRECCIÓN 1/6/20/21 — Guías de Uso (contenido HTML, biblioteca completa).
router.get('/guides', guideController.listGuidesAdmin);
router.post('/guides', guideController.createGuide);
router.patch('/guides/:id', guideController.updateGuide);
router.delete('/guides/:id', guideController.deleteGuide);

module.exports = router;
