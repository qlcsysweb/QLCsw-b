const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { encrypt, decrypt } = require('../utils/crypto');
const { notifyClient } = require('../utils/notify');
const { isValidIp } = require('../utils/ipValidation');
const {
  getNextSlotIndex,
  countActiveSubaccounts,
  MAX_SUBACCOUNTS_PER_CLIENT,
  PROCESS_CONDITION_TYPES,
} = require('../utils/subaccountProvisioning');
const subaccountRequestService = require('../services/subaccountRequestService');

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
    include: { process: { include: { conditions: true } } },
  });

  res.status(201).json({ ok: true, subaccount });
});

const updateSubaccountSchema = z.object({
  identifier: z.string().min(1).nullable().optional(),
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
    let eventType = 'DISCONNECTED';
    if (data.status === 'CONECTADA') {
      const priorConnections = await prisma.apiConnectionEvent.count({
        where: { apiSubaccountId: updated.id, eventType: { in: ['ACTIVATED', 'RECONNECTED'] } },
      });
      eventType = priorConnections === 0 ? 'ACTIVATED' : 'RECONNECTED';
    }
    await prisma.apiConnectionEvent.create({
      data: {
        apiSubaccountId: updated.id,
        eventType,
        reason: data.connectionReason || null,
      },
    });

    if (updated.status === 'CONECTADA') {
      const process = await prisma.process.findUnique({ where: { apiSubaccountId: updated.id } });
      if (process) {
        await prisma.processCondition.update({
          where: { processId_type: { processId: process.id, type: 'API' } },
          data: { status: 'CONFIRMED' },
        });
      }
    }

    await notifyClient(existing.clientId, {
      title: 'Actualización de tu conexión API',
      message: `Estado de tu conexión API${updated.identifier ? ` (${updated.identifier})` : ''}: ${updated.status}`,
      type: updated.status === 'CONECTADA' ? 'success' : 'info',
      templateKey: 'api_connection_status_updated',
      templateParams: { status: updated.status, identifier: updated.identifier, apiSubaccountId: updated.id },
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

const reviewCapitalDistributionReportSchema = z.object({
  status: z.enum(['APROBADO', 'RECHAZADO', 'EN_REVISION']),
  reviewNote: z.string().max(500).optional(),
});

const reviewCapitalDistributionReport = asyncHandler(async (req, res) => {
  const { status, reviewNote } = reviewCapitalDistributionReportSchema.parse(req.body);
  const report = await prisma.capitalDistributionReport.findUnique({ where: { id: req.params.id } });
  if (!report) throw ApiError.notFound('Reporte no encontrado');

  const updated = await prisma.capitalDistributionReport.update({
    where: { id: report.id },
    data: { status, reviewNote: reviewNote || null, reviewedByUserId: req.user.id, reviewedAt: new Date() },
  });

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
    type: status === 'APROBADO' ? 'success' : status === 'RECHAZADO' ? 'warning' : 'info',
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

module.exports = {
  createSubaccount,
  updateSubaccount,
  getSubaccountSecrets,
  listCapitalDistributionReports,
  reviewCapitalDistributionReport,
  listRequests,
  approveCreateRequest,
  approveDeactivateRequest,
  rejectRequest,
  deactivateSubaccountDirect,
  activateSubaccountDirect,
  listAuditCandidates,
  MAX_SUBACCOUNTS_PER_CLIENT,
};
