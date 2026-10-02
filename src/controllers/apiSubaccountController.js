const { z } = require('zod');
const { clientSubaccountLabel } = require('../utils/subaccountLabels');
const { recordConnectionEvent, syncConditionFromConnection } = require('../utils/apiConnectionSync');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { encrypt, decrypt } = require('../utils/crypto');
const { notifyClient } = require('../utils/notify');
const { isValidIp } = require('../utils/ipValidation');
const {
  ensureParticipationModel,
  getNextSlotIndex,
  countActiveSubaccounts,
  MAX_SUBACCOUNTS_PER_CLIENT,
  PROCESS_CONDITION_TYPES,
} = require('../utils/subaccountProvisioning');
const subaccountRequestService = require('../services/subaccountRequestService');
const { ACTIVE_CAPITAL_STATUSES } = require('../utils/capitalDistribution');

// CORRECCIÓN 11/16: cada subcuenta nace con su propio proceso de
// activación (5 condiciones) — igual que antes nacía a nivel cliente.
const createSubaccountSchema = z.object({
  identifier: z.string().min(1).optional(),
  requiredCapital: z.number().positive().optional(),
});

// Creación manual directa por un admin (sin pasar por una solicitud del
// cliente) — el admin conserva el control final de la creación en
// cualquier momento, como pide la gestión dinámica de subcuentas.
const createSubaccount = asyncHandler(async (req, res) => {
  const data = createSubaccountSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  // CORREGIR.xlsx CLIENTE 06: la cuenta PRINCIPAL (slotIndex 0) nunca cuenta
  // contra el máximo de 20 subcuentas/API numeradas.
  const activeCount = await countActiveSubaccounts(client.id);
  if (activeCount >= MAX_SUBACCOUNTS_PER_CLIENT) {
    throw ApiError.conflict(`Este cliente ya tiene el máximo de ${MAX_SUBACCOUNTS_PER_CLIENT} subcuentas/API.`);
  }

  if (data.identifier) {
    const existingIdentifier = await prisma.apiSubaccount.findUnique({ where: { identifier: data.identifier } });
    if (existingIdentifier) throw ApiError.conflict('Ese identificador ya está en uso por otra subcuenta.');
  }

  const nextSlot = await getNextSlotIndex(client.id);
  const subaccount = await prisma.apiSubaccount.create({
    data: {
      clientId: client.id,
      slotIndex: nextSlot,
      identifier: data.identifier || null,
      requiredCapital: data.requiredCapital ?? null,
      updatedByUserId: req.user.id,
      process: {
        create: {
          conditions: {
            create: PROCESS_CONDITION_TYPES.map((type) => ({ type, status: 'PENDING' })),
          },
        },
      },
    },
    include: { process: { include: { conditions: { where: { type: { not: 'WALLET' } } } } } },
  });
  // Modelo único de participación (50% QLC / 50% Cliente), asignado automáticamente.
  await ensureParticipationModel(subaccount.id);

  res.status(201).json({ ok: true, subaccount });
});

const updateSubaccountSchema = z.object({
  // IDENTIFICADOR INTERNO (ej. PCB-1-A-1) — obligatorio, editable a voluntad
  // por el ADMIN desde la sección API Key; nunca se muestra al cliente.
  identifier: z.string().trim().min(1, 'El identificador interno es obligatorio.').max(60).optional(),
  exchangeName: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
  apiPassphrase: z.string().min(1).optional(),
  status: z.enum(['CONECTADA', 'DESCONECTADA', 'PENDIENTE']).optional(),
  requiredCapital: z.number().positive().nullable().optional(),
  notes: z.string().optional(),
  // CORRECCIÓN 19: motivo opcional del cambio de estado de conexión.
  connectionReason: z.string().optional(),
  // CORRECCIÓN 6/18 (bloque de 20) — dato administrativo, sin conexión real
  // al exchange. Si se marca ipRequired=true, ipAddress debe tener formato
  // válido (se valida abajo, no en el schema, porque depende del otro campo).
  ipRequired: z.boolean().optional(),
  ipAddress: z.string().nullable().optional(),
});

const updateSubaccount = asyncHandler(async (req, res) => {
  const data = updateSubaccountSchema.parse(req.body);
  const existing = await prisma.apiSubaccount.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');
  if (existing.deactivatedAt) throw ApiError.conflict('Esta subcuenta está inactiva. Actívala antes de editarla.');

  if (!(data.identifier ?? existing.identifier)) {
    throw ApiError.badRequest('El identificador interno de la subcuenta (ej. PCB-1-A-1) es obligatorio.');
  }
  if (data.identifier && data.identifier !== existing.identifier) {
    const clash = await prisma.apiSubaccount.findUnique({ where: { identifier: data.identifier } });
    if (clash) throw ApiError.conflict('Ese identificador ya está en uso por otra subcuenta.');
  }

  const willRequireIp = data.ipRequired ?? existing.ipRequired;
  const finalIp = data.ipAddress !== undefined ? data.ipAddress : existing.ipAddress;
  if (willRequireIp && finalIp && !isValidIp(finalIp)) {
    throw ApiError.badRequest('La IP no tiene un formato válido.');
  }

  const statusChanged = data.status && data.status !== existing.status;

  const updated = await prisma.apiSubaccount.update({
    where: { id: req.params.id },
    data: {
      ...(data.identifier !== undefined ? { identifier: data.identifier } : {}),
      ...(data.exchangeName ? { exchangeName: data.exchangeName } : {}),
      ...(data.apiKey ? { apiKeyEncrypted: encrypt(data.apiKey) } : {}),
      ...(data.apiSecret ? { apiSecretEncrypted: encrypt(data.apiSecret) } : {}),
      ...(data.apiPassphrase ? { apiPassphraseEncrypted: encrypt(data.apiPassphrase) } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.requiredCapital !== undefined ? { requiredCapital: data.requiredCapital } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.ipRequired !== undefined ? { ipRequired: data.ipRequired } : {}),
      ...(data.ipAddress !== undefined ? { ipAddress: data.ipAddress } : {}),
      ...(statusChanged && data.status === 'DESCONECTADA' ? { disconnectedAt: new Date() } : {}),
      ...(statusChanged && data.status === 'CONECTADA' ? { reconnectedAt: new Date() } : {}),
      updatedByUserId: req.user.id,
    },
  });

  if (statusChanged) {
    // CORRECCIÓN 19/25: historial detallado de conexión/desconexión — la
    // PRIMERA conexión de una subcuenta se registra como ACTIVATED, las
    // siguientes como RECONNECTED, para distinguir activación inicial de
    // reactivaciones posteriores.
    await recordConnectionEvent(updated.id, updated.status, data.connectionReason);
    // El paso "Conexión API" del proceso se ajusta al nuevo estado
    // (CONECTADA → confirmado, DESCONECTADA → rechazado, PENDIENTE → pendiente).
    await syncConditionFromConnection(updated.id, updated.status);

    await notifyClient(existing.clientId, {
      title: 'Actualización de tu conexión API',
      message: `Estado de tu conexión API (${clientSubaccountLabel(updated)}): ${updated.status}`,
      type: updated.status === 'CONECTADA' ? 'success' : 'info',
      templateKey: 'api_connection_status_updated',
      templateParams: { status: updated.status, identifier: clientSubaccountLabel(updated), apiSubaccountId: updated.id },
    });
  }

  res.json({
    ok: true,
    subaccount: {
      ...updated,
      apiKeyEncrypted: undefined,
      apiSecretEncrypted: undefined,
      apiPassphraseEncrypted: undefined,
      hasApiKey: Boolean(updated.apiKeyEncrypted),
      hasApiSecret: Boolean(updated.apiSecretEncrypted),
      hasApiPassphrase: Boolean(updated.apiPassphraseEncrypted),
    },
  });
});

// El admin puede visualizar y copiar la API Key/Secret/Passphrase reales
// (alcance §8/CORRECCIÓN 10) — se descifra SOLO aquí, nunca en listados.
const getSubaccountSecrets = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: req.params.id } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  res.json({
    ok: true,
    secrets: {
      apiKey: subaccount.apiKeyEncrypted ? decrypt(subaccount.apiKeyEncrypted) : null,
      apiSecret: subaccount.apiSecretEncrypted ? decrypt(subaccount.apiSecretEncrypted) : null,
      apiPassphrase: subaccount.apiPassphraseEncrypted ? decrypt(subaccount.apiPassphraseEncrypted) : null,
    },
  });
});

// CORREGIR.xlsx CLIENTE 13 — revisión admin de los reportes de distribución
// de capital (mismo patrón que la revisión de pagos): el admin aprueba o
// rechaza; solo al aprobar se confirma la condición FUNDS y se marca
// clientReportedCapitalReady (nunca automáticamente al reportar).
const listCapitalDistributionReports = asyncHandler(async (req, res) => {
  const { status, clientId, apiSubaccountId } = req.query;
  const reports = await prisma.capitalDistributionReport.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(apiSubaccountId ? { apiSubaccountId } : {}),
      ...(clientId ? { apiSubaccount: { clientId } } : {}),
    },
    orderBy: { reportedAt: 'desc' },
    include: {
      apiSubaccount: { select: { identifier: true, slotIndex: true, client: { select: { firstName: true, lastName: true } } } },
    },
  });
  res.json({ ok: true, reports });
});

// BORRADOR de la revisión del admin (reutiliza el estado EN_REVISION, sin
// enum nuevo): la nota de revisión se prepara y se guarda sobre el MISMO
// registro (UPDATE) tantas veces como haga falta, sin notificar al cliente ni
// dejarla como definitiva. Solo existe mientras la confirmación no esté
// finalizada (aprobada/rechazada).
const capitalDraftSchema = z.object({ reviewNote: z.string().max(500).optional() });

async function findReviewableCapitalReport(id) {
  const report = await prisma.capitalDistributionReport.findUnique({ where: { id } });
  if (!report) throw ApiError.notFound('Reporte no encontrado');
  if (!ACTIVE_CAPITAL_STATUSES.includes(report.status)) {
    throw ApiError.conflict('Este reporte ya fue finalizado; no se puede modificar su borrador.');
  }
  return report;
}

const saveCapitalDistributionDraft = asyncHandler(async (req, res) => {
  const { reviewNote } = capitalDraftSchema.parse(req.body);
  const report = await findReviewableCapitalReport(req.params.id);
  // updateMany condicionado al estado: si otro admin lo finalizó entre la
  // lectura y el guardado, el borrador no pisa el registro definitivo.
  const { count } = await prisma.capitalDistributionReport.updateMany({
    where: { id: report.id, status: { in: ACTIVE_CAPITAL_STATUSES } },
    data: { status: 'EN_REVISION', reviewNote: reviewNote?.trim() || null, reviewedByUserId: req.user.id },
  });
  if (!count) throw ApiError.conflict('Este reporte ya fue finalizado; no se puede modificar su borrador.');
  const updated = await prisma.capitalDistributionReport.findUnique({ where: { id: report.id } });
  res.json({ ok: true, report: updated });
});

// ELIMINAR BORRADOR — descarta solo la revisión en preparación (nota +
// estado vuelve a PENDING). La confirmación del cliente nunca se borra.
const discardCapitalDistributionDraft = asyncHandler(async (req, res) => {
  const report = await findReviewableCapitalReport(req.params.id);
  const { count } = await prisma.capitalDistributionReport.updateMany({
    where: { id: report.id, status: { in: ACTIVE_CAPITAL_STATUSES } },
    data: { status: 'PENDING', reviewNote: null, reviewedByUserId: null, reviewedAt: null },
  });
  if (!count) throw ApiError.conflict('Este reporte ya fue finalizado; no se puede modificar su borrador.');
  const updated = await prisma.capitalDistributionReport.findUnique({ where: { id: report.id } });
  res.json({ ok: true, report: updated });
});

const reviewCapitalDistributionReportSchema = z.object({
  status: z.enum(['APROBADO', 'RECHAZADO', 'EN_REVISION']),
  reviewNote: z.string().max(500).optional(),
});

// FINALIZAR — aprobar/rechazar actualiza el MISMO registro (borrador →
// definitivo). La transición es atómica y solo desde PENDING/EN_REVISION:
// un doble clic o un reintento no vuelve a notificar ni re-procesa; repetir
// el mismo estado final responde idempotente con el registro actual.
const reviewCapitalDistributionReport = asyncHandler(async (req, res) => {
  const { status, reviewNote } = reviewCapitalDistributionReportSchema.parse(req.body);
  if (status === 'EN_REVISION') return saveCapitalDistributionDraft(req, res);

  const report = await prisma.capitalDistributionReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte no encontrado');

  const { count } = await prisma.capitalDistributionReport.updateMany({
    where: { id: report.id, status: { in: ACTIVE_CAPITAL_STATUSES } },
    data: {
      status,
      // Sin nota nueva se conserva la del borrador guardado.
      reviewNote: reviewNote !== undefined ? reviewNote.trim() || null : report.reviewNote,
      reviewedByUserId: req.user.id,
      reviewedAt: new Date(),
    },
  });
  if (!count) {
    const current = await prisma.capitalDistributionReport.findUnique({ where: { id: report.id } });
    if (current.status === status) return res.json({ ok: true, report: current, alreadyReviewed: true });
    throw ApiError.conflict('Este reporte ya fue finalizado.');
  }
  const updated = await prisma.capitalDistributionReport.findUnique({ where: { id: report.id } });

  if (status === 'APROBADO') {
    await prisma.apiSubaccount.update({
      where: { id: report.apiSubaccountId },
      data: { clientReportedCapitalReady: true, clientReportedCapitalAt: new Date() },
    });
    const process = await prisma.process.findUnique({ where: { apiSubaccountId: report.apiSubaccountId } });
    if (process) {
      await prisma.processCondition.updateMany({
        where: { processId: process.id, type: 'FUNDS' },
        data: { status: 'CONFIRMED' },
      });
    }
  }

  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: report.apiSubaccountId } });
  await notifyClient(subaccount.clientId, {
    title: 'Actualización de tu reporte de distribución de capital',
    message: `Tu reporte de distribución de capital (${report.amount} USDT) fue marcado como: ${status}`,
    type: status === 'APROBADO' ? 'success' : 'warning',
    templateKey: 'capital_distribution_report_updated',
    templateParams: { amount: String(report.amount), status, apiSubaccountId: report.apiSubaccountId },
  });

  res.json({ ok: true, report: updated });
});

// GESTIÓN DINÁMICA DE SUBCUENTAS — cola de solicitudes de creación/
// desactivación, en un solo lugar sin tener que recorrer cliente por cliente.
const listRequestsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  type: z.enum(['CREATE', 'DEACTIVATE']).optional(),
});

const listRequests = asyncHandler(async (req, res) => {
  const { status, type } = listRequestsSchema.parse(req.query);
  const requests = await subaccountRequestService.listRequestsForAdmin({ status, type });
  res.json({ ok: true, requests });
});

const approveCreateRequestSchema = z.object({
  identifier: z.string().min(1).optional(),
  requiredCapital: z.number().positive().optional(),
});

const approveCreateRequest = asyncHandler(async (req, res) => {
  const data = approveCreateRequestSchema.parse(req.body || {});
  const result = await subaccountRequestService.approveCreateRequest({
    requestId: req.params.id,
    ...data,
    reviewedByUserId: req.user.id,
  });
  res.json({ ok: true, ...result });
});

const approveDeactivateRequest = asyncHandler(async (req, res) => {
  const deactivated = await subaccountRequestService.approveDeactivateRequest({
    requestId: req.params.id,
    reviewedByUserId: req.user.id,
  });
  res.json({ ok: true, subaccount: deactivated });
});

const rejectRequestSchema = z.object({ reviewNote: z.string().max(500).optional() });

const rejectRequest = asyncHandler(async (req, res) => {
  const { reviewNote } = rejectRequestSchema.parse(req.body || {});
  const request = await subaccountRequestService.rejectRequest({
    requestId: req.params.id,
    reviewNote,
    reviewedByUserId: req.user.id,
  });
  res.json({ ok: true, request });
});

// Desactivación directa desde el panel admin, sin pasar por una solicitud
// previa del cliente — el admin conserva el control final. Se exige que la
// subcuenta pertenezca al :clientId de la ruta (defensa contra IDOR: un id
// de subcuenta de OTRO cliente nunca calza y responde 404). Nunca elimina —
// solo cambia el estado a INACTIVA (reversible con activateSubaccountDirect).
const deactivateSubaccountSchema = z.object({ reviewNote: z.string().max(500).optional() });

const deactivateSubaccountDirect = asyncHandler(async (req, res) => {
  const { reviewNote } = deactivateSubaccountSchema.parse(req.body || {});
  const deactivated = await subaccountRequestService.deactivateSubaccount({
    clientId: req.params.clientId,
    apiSubaccountId: req.params.id,
    deactivatedByUserId: req.user.id,
    reviewNote,
  });
  res.json({ ok: true, subaccount: deactivated });
});

// Reactivación directa — mismo control IDOR (clientId de la ruta debe
// coincidir con el dueño real de la subcuenta).
const activateSubaccountDirect = asyncHandler(async (req, res) => {
  const activated = await subaccountRequestService.activateSubaccount({
    clientId: req.params.clientId,
    apiSubaccountId: req.params.id,
    activatedByUserId: req.user.id,
  });
  res.json({ ok: true, subaccount: activated });
});

// AUDITORÍA §8 — herramienta de solo lectura para que el admin identifique,
// cliente por cliente, qué subcuentas activas parecen no usarse (sin
// identificador, sin API configurada, sin estados de cuenta/pagos/
// documentos ni actividad de conexión) y sean candidatas a revisar para una
// posible desactivación manual. NUNCA cambia nada por sí sola.
const listAuditCandidates = asyncHandler(async (req, res) => {
  const subaccounts = await prisma.apiSubaccount.findMany({
    where: { isPrincipal: false, deactivatedAt: null },
    orderBy: [{ clientId: 'asc' }, { slotIndex: 'asc' }],
    include: {
      client: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
      _count: { select: { statements: true, paymentReports: true, connectionEvents: true } },
    },
  });

  const documentCounts = await prisma.document.groupBy({
    by: ['clientId'],
    _count: true,
  });
  const documentCountByClient = new Map(documentCounts.map((d) => [d.clientId, d._count]));

  res.json({
    ok: true,
    subaccounts: subaccounts.map((s) => {
      const hasStatements = s._count.statements > 0;
      const hasPayments = s._count.paymentReports > 0;
      const hasActivity = s._count.connectionEvents > 0;
      const hasApi = Boolean(s.apiKeyEncrypted);
      const hasDocuments = (documentCountByClient.get(s.clientId) || 0) > 0;
      const candidateForReview =
        !s.identifier && !hasApi && !hasStatements && !hasPayments && !hasActivity && s.status === 'PENDIENTE';
      return {
        id: s.id,
        clientId: s.clientId,
        clientName: `${s.client.firstName} ${s.client.lastName}`,
        clientEmail: s.client.user?.email || null,
        identifier: s.identifier,
        slotIndex: s.slotIndex,
        status: s.status,
        createdAt: s.createdAt,
        hasStatements,
        hasPayments,
        hasDocuments,
        hasActivity,
        hasApi,
        candidateForReview,
      };
    }),
  });
});

// BUSCADOR POR IDENTIFICADOR (admin) — escribe el identificador (completo o
// una parte, sin distinguir mayúsculas) y devuelve la subcuenta y el cliente
// al que está ligada.
const searchByIdentifier = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, results: [] });
  const results = await prisma.apiSubaccount.findMany({
    where: { identifier: { contains: q, mode: 'insensitive' } },
    orderBy: { identifier: 'asc' },
    take: 20,
    select: {
      id: true,
      identifier: true,
      isPrincipal: true,
      slotIndex: true,
      status: true,
      deactivatedAt: true,
      client: { select: { id: true, username: true, firstName: true, lastName: true } },
    },
  });
  res.json({ ok: true, results });
});

// BORRAR EVENTO DEL HISTORIAL DE CONEXIÓN (admin) — deja de mostrarse al
// admin y al cliente. Se conserva internamente: el sistema lo cuenta para
// saber si una conexión es la primera (ACTIVADA) o una reconexión.
const hideConnectionEvent = asyncHandler(async (req, res) => {
  const { count } = await prisma.apiConnectionEvent.updateMany({
    where: { id: req.params.eventId, apiSubaccountId: req.params.id, hiddenAt: null },
    data: { hiddenAt: new Date() },
  });
  if (!count) throw ApiError.notFound('Evento no encontrado');
  res.json({ ok: true });
});

// BORRAR DEL HISTORIAL "Distribución de capital" (admin) — solo reportes ya
// revisados. Se oculta para el admin; el cliente y el proceso no cambian.
const hideCapitalDistributionReportForAdmin = asyncHandler(async (req, res) => {
  const report = await prisma.capitalDistributionReport.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, adminHiddenAt: true },
  });
  if (!report || report.adminHiddenAt) throw ApiError.notFound('Reporte no encontrado');
  if (!['APROBADO', 'RECHAZADO'].includes(report.status)) {
    throw ApiError.badRequest('Este reporte sigue en revisión; podrás borrarlo cuando lo confirmes o rechaces.');
  }
  await prisma.capitalDistributionReport.update({ where: { id: report.id }, data: { adminHiddenAt: new Date() } });
  res.json({ ok: true });
});

module.exports = {
  hideCapitalDistributionReportForAdmin,
  hideConnectionEvent,
  searchByIdentifier,
  createSubaccount,
  updateSubaccount,
  getSubaccountSecrets,
  listCapitalDistributionReports,
  reviewCapitalDistributionReport,
  saveCapitalDistributionDraft,
  discardCapitalDistributionDraft,
  listRequests,
  approveCreateRequest,
  approveDeactivateRequest,
  rejectRequest,
  deactivateSubaccountDirect,
  activateSubaccountDirect,
  listAuditCandidates,
  MAX_SUBACCOUNTS_PER_CLIENT,
};
