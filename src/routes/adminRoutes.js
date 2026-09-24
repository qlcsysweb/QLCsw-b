const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadDocument: uploadDocumentFile, uploadMedia } = require('../middleware/upload');

const dashboardController = require('../controllers/dashboardController');
const clientController = require('../controllers/clientController');
const apiSubaccountController = require('../controllers/apiSubaccountController');
const processController = require('../controllers/processController');
const modelController = require('../controllers/modelController');
const contentController = require('../controllers/contentController');
const faqController = require('../controllers/faqController');
const trackRecordController = require('../controllers/trackRecordController');
const adminController = require('../controllers/adminController');
const documentController = require('../controllers/documentController');
const statementController = require('../controllers/statementController');
const paymentController = require('../controllers/paymentController');
const appointmentController = require('../controllers/appointmentController');
const supportController = require('../controllers/supportController');
const chatController = require('../controllers/chatController');
const prospectController = require('../controllers/prospectController');
const driveConfigController = require('../controllers/driveConfigController');
const emailConfigController = require('../controllers/emailConfigController');
const mediaController = require('../controllers/mediaController');
const platformSettingsController = require('../controllers/platformSettingsController');
const guideController = require('../controllers/guideController');
const securityConfigController = require('../controllers/securityConfigController');
const processStepController = require('../controllers/processStepController');
const adminMessageController = require('../controllers/adminMessageController');
// AUDITORÍA FINAL — Pendiente #1: el controlador de notificaciones ya es
// genérico (usa req.user.id, sin lógica específica de cliente); se reutiliza
// tal cual para exponer las notificaciones del ADMIN (antes no existía
// ninguna ruta/interfaz para verlas, por lo que la alerta de vencimiento de
// contrato quedaba invisible aunque se generara en BD).
const notificationController = require('../controllers/client/notificationController');

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// Dashboard
router.get('/dashboard', dashboardController.getSummary);

// Clients
router.get('/clients', clientController.listClients);
router.post('/clients', clientController.createClient);
router.get('/clients/:id', clientController.getClient);
router.patch('/clients/:id', clientController.updateClient);
router.post('/clients/:id/assign-username', clientController.assignUsername);
router.patch('/clients/:id/active', clientController.setClientActive);
router.delete('/clients/:id', clientController.deleteClient);

// Subcuentas / API — GESTIÓN DINÁMICA: cada cliente nace con únicamente su
// cuenta PRINCIPAL; cualquier subcuenta adicional nace de una solicitud del
// cliente aprobada por un admin, o de una creación manual directa.
router.post('/clients/:clientId/api-subaccounts', apiSubaccountController.createSubaccount);
router.patch('/api-subaccounts/:id', apiSubaccountController.updateSubaccount);
router.get('/api-subaccounts/:id/secrets', apiSubaccountController.getSubaccountSecrets);
// Subcuentas por ESTADO — activar/desactivar, reversible, nunca eliminar.
router.post('/clients/:clientId/api-subaccounts/:id/deactivate', apiSubaccountController.deactivateSubaccountDirect);
router.post('/clients/:clientId/api-subaccounts/:id/activate', apiSubaccountController.activateSubaccountDirect);
router.get('/subaccounts/audit', apiSubaccountController.listAuditCandidates);

// Cola de solicitudes de creación/desactivación de subcuenta.
router.get('/subaccount-requests', apiSubaccountController.listRequests);
router.post('/subaccount-requests/:id/approve-create', apiSubaccountController.approveCreateRequest);
router.post('/subaccount-requests/:id/approve-deactivate', apiSubaccountController.approveDeactivateRequest);
router.post('/subaccount-requests/:id/reject', apiSubaccountController.rejectRequest);

// CORREGIR.xlsx CLIENTE 13 — revisión de reportes de distribución de capital
router.get('/capital-distribution-reports', apiSubaccountController.listCapitalDistributionReports);
router.patch('/capital-distribution-reports/:id', apiSubaccountController.reviewCapitalDistributionReport);

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

// Administrators
router.get('/admins', adminController.listAdmins);
router.post('/admins', adminController.createAdmin);
router.patch('/admins/:id', adminController.updateAdmin);
// CORREGIR(2).xlsx ADMIN 36 — designar/quitar al "administrador general"
// (único que puede eliminar clientes con la contraseña de seguridad).
// Solo un administrador general existente puede otorgar/quitar el rol a
// otro; si todavía no existe ninguno, se permite el auto-nombramiento una
// sola vez (arranque del sistema).
router.patch('/admins/:id/general', adminController.setGeneralAdmin);
// Eliminación real (no desactivación) — exige que el administrador ya esté
// desactivado y sin actividad histórica registrada (ver adminController).
router.delete('/admins/:id', adminController.deleteAdmin);

// Documents (identidad del cliente → Google Drive)
// CORRECCIÓN 7 (bloque de 20) — el admin ya NO puede subir documentos desde
// la ficha del cliente, solo visualizar/descargar. La carga es exclusiva
// del cliente (ver clientRoutes.js) — se retira la ruta a propósito, no
// solo el botón en el frontend.
router.get('/clients/:clientId/documents', documentController.listDocumentsByClient);
router.get('/documents/:id/download', documentController.downloadDocument);
router.delete('/documents/:id', documentController.deleteDocument);
// REVERSIÓN A: única forma de que el cliente pueda eliminar/reemplazar un
// documento puntual — el admin lo habilita temporalmente.
router.patch('/documents/:id/unlock', documentController.setDocumentUnlock);
// CORREGIR.xlsx ADMIN 07 — organización Año/Periodo/Mes tipo Google Drive
router.patch('/documents/:id/organize', documentController.setDocumentOrganization);

// Estado de cuenta — se genera desde la subcuenta/API (Generar → PENDIENTE
// DE PAGO + 72 h). La comunicación al cliente es la mensajería interna +
// correo, sin un flujo de "envío" separado.
router.get('/api-subaccounts/:apiSubaccountId/statements', statementController.listStatements);
router.post('/api-subaccounts/:apiSubaccountId/statements', statementController.createStatement);
router.get('/statements/:id/download', statementController.downloadStatementFile);
router.patch('/statements/:id/mark-paid', statementController.markStatementPaid);

// Pagos / Garantía — UID de recepción Bitget (configurable solo por ADMIN)
// y reportes de transferencia interna Bitget.
router.get('/payment-config', paymentController.getPaymentConfig);
router.put('/payment-config', paymentController.updatePaymentConfig);
router.get('/payment-reports', paymentController.listPaymentReports);
router.get('/payment-reports/:id/proof', paymentController.downloadPaymentProof);
router.patch('/payment-reports/:id/transfer-received', paymentController.markTransferReceived);
router.patch('/payment-reports/:id/guarantee-reported', paymentController.markGuaranteeReported);
router.patch('/payment-reports/:id', paymentController.reviewPaymentReport);

// Appointments
router.get('/availability', appointmentController.listAvailability);
router.put('/availability', appointmentController.setAvailability);
router.get('/appointments', appointmentController.listAppointments);
router.patch('/appointments/:id/status', appointmentController.updateAppointmentStatus);

// Support / Chat
router.get('/support-cases', supportController.listSupportCases);
router.patch('/support-cases/:id', supportController.updateSupportCase);
router.get('/support-cases/:id/messages', supportController.listCaseMessages);
router.post('/support-cases/:id/messages', supportController.sendCaseMessage);
router.get('/chat-sessions', chatController.listSessions);
// CORREGIR(2).xlsx ADMIN 28 — permite ver/entrar directamente al chat de una
// cita ya autorizada desde la propia vista de la cita.
router.get('/appointments/:appointmentId/chat-session', chatController.getSessionByAppointment);
router.get('/chat/:id', chatController.getSession);
router.post('/chat/:id/start', chatController.startSession);
router.post('/chat/:id/messages', chatController.sendMessage);
router.post('/chat/:id/close', chatController.closeSession);
router.get('/chat/:id/pdf', chatController.downloadSessionPdf);

// Prospects
router.get('/prospects', prospectController.listProspects);
router.patch('/prospects/:id', prospectController.updateProspectStatus);
// CORREGIR.xlsx ADMIN 05: borrado manual (además de la limpieza automática
// a los 5 días de DESCARTADO, ejecutada de forma perezosa en listProspects).
router.delete('/prospects/:id', prospectController.deleteProspect);

// CORREGIR.xlsx ADMIN 06 — contraseña de seguridad para eliminar clientes
router.get('/security-config', securityConfigController.getStatus);
router.put('/security-config/password', securityConfigController.setPassword);

// AUDITORÍA FINAL — Pendiente #1: notificaciones del admin.
router.get('/notifications', notificationController.listNotifications);
router.patch('/notifications/:id/read', notificationController.markAsRead);
router.post('/notifications/read-all', notificationController.markAllAsRead);

// CORREGIR.xlsx ADMIN 14 — mensajería manual admin→cliente
router.get('/clients/:clientId/messages', adminMessageController.listForClient);
router.post('/clients/:clientId/messages', adminMessageController.sendMessage);

// CORREGIR.xlsx CLIENTE 07 — "Tu proceso paso a paso" editable (CMS)
router.get('/process-steps', processStepController.listStepsAdmin);
router.post('/process-steps', processStepController.createStep);
router.patch('/process-steps/:id', processStepController.updateStep);
router.delete('/process-steps/:id', processStepController.deleteStep);

// Configuración de Google Drive (Admin → Configuración → Google Drive)
// CORRECCIÓN 24: bloqueada tras la primera configuración — solo quien la
// configuró puede editarla o desconectarla.
router.get('/drive-config', driveConfigController.getConfig);
router.put('/drive-config', driveConfigController.updateConfig);
router.get('/drive-config/oauth/start', driveConfigController.oauthStart);
router.post('/drive-config/test', driveConfigController.testConnection);
router.post('/drive-config/disconnect', driveConfigController.disconnect);

// AUDITORÍA QLC PARTE 13 — configuración de correo (Gmail) desde el panel.
router.get('/email-config', emailConfigController.getConfig);
router.put('/email-config', emailConfigController.updateConfig);
router.post('/email-config/test', emailConfigController.testConnection);
router.post('/email-config/disconnect', emailConfigController.disconnect);
// Gmail API vía OAuth2 (evita el bloqueo de puertos SMTP de Render free
// tier) — el callback de Google vive en publicRoutes.js, fuera de este
// middleware de auth (ver ese archivo para la explicación).
router.get('/email-config/oauth/start', emailConfigController.oauthStart);

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
