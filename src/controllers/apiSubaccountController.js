const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { encrypt, decrypt } = require('../utils/crypto');
const { notifyClient } = require('../utils/notify');
const { isValidIp } = require('../utils/ipValidation');
const {
  ensureAllSubaccounts,
  MAX_SUBACCOUNTS_PER_CLIENT,
  PROCESS_CONDITION_TYPES,
} = require('../utils/subaccountProvisioning');

// CORRECCIÓN 11/16: cada subcuenta nace con su propio proceso de
// activación (5 condiciones) — igual que antes nacía a nivel cliente.
const createSubaccountSchema = z.object({
  identifier: z.string().min(1).optional(),
  requiredCapital: z.number().positive().optional(),
});

const createSubaccount = asyncHandler(async (req, res) => {
  const data = createSubaccountSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  // CORREGIR.xlsx CLIENTE 06: la cuenta PRINCIPAL (slotIndex 0) nunca cuenta
  // contra el máximo de 20 subcuentas/API numeradas.
  const count = await prisma.apiSubaccount.count({ where: { clientId: client.id, isPrincipal: false } });
  if (count >= MAX_SUBACCOUNTS_PER_CLIENT) {
    throw ApiError.conflict(`Este cliente ya tiene el máximo de ${MAX_SUBACCOUNTS_PER_CLIENT} subcuentas/API.`);
  }

  if (data.identifier) {
    const existingIdentifier = await prisma.apiSubaccount.findUnique({ where: { identifier: data.identifier } });
    if (existingIdentifier) throw ApiError.conflict('Ese identificador ya está en uso por otra subcuenta.');
  }

  // CORRECCIÓN 1: si el cliente ya registró su wallet antes de que existiera
  // esta subcuenta, el paso "WALLET" nace confirmado — nunca se le vuelve a
  // pedir un dato que ya tiene guardado.
  const clientHasWallet = Boolean(client.walletAddress);

  const nextSlot = count + 1;
  const subaccount = await prisma.apiSubaccount.create({
    data: {
      clientId: client.id,
      slotIndex: nextSlot,
      identifier: data.identifier || null,
      requiredCapital: data.requiredCapital ?? null,
      // A diferencia de las 20 subcuentas pre-creadas al registro (que
      // nacen ocultas), una subcuenta que el admin crea aquí manualmente
      // es visible de inmediato para el cliente.
      visibleToClient: true,
      updatedByUserId: req.user.id,
      process: {
        create: {
          conditions: {
            create: PROCESS_CONDITION_TYPES.map((type) => ({
              type,
              status: type === 'WALLET' && clientHasWallet ? 'CONFIRMED' : 'PENDING',
            })),
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
  // CORRECCIÓN (subcuentas ocultas) — revela al cliente una subcuenta que
  // nació oculta. Nunca se vuelve a ocultar desde aquí (one-way).
  visibleToClient: z.boolean().optional(),
});

const updateSubaccount = asyncHandler(async (req, res) => {
  const data = updateSubaccountSchema.parse(req.body);
  const existing = await prisma.apiSubaccount.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');

  // Revelar una subcuenta sin capital operativo configurado dejaría al
  // cliente viendo "pendiente de configuración" justo cuando el admin cree
  // que ya quedó lista — se exige el monto en el mismo paso.
  const revealingNow = data.visibleToClient === true && !existing.visibleToClient;
  if (revealingNow && data.requiredCapital == null && existing.requiredCapital == null) {
    throw ApiError.badRequest(
      'Indica el capital operativo requerido (USDT) antes de revelar esta subcuenta al cliente.'
    );
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
      ...(data.visibleToClient !== undefined ? { visibleToClient: data.visibleToClient } : {}),
      ...(statusChanged && data.status === 'DESCONECTADA' ? { disconnectedAt: new Date() } : {}),
      ...(statusChanged && data.status === 'CONECTADA' ? { reconnectedAt: new Date() } : {}),
      updatedByUserId: req.user.id,
    },
  });

  if (revealingNow) {
    await prisma.clientProfile.update({
      where: { id: existing.clientId },
      data: { subaccountRequestedAt: null },
    });
    await notifyClient(existing.clientId, {
      title: 'Nueva subcuenta disponible',
      message: `QLC habilitó una subcuenta adicional para ti${
        updated.requiredCapital != null ? ` — capital operativo requerido: ${updated.requiredCapital} USDT` : ''
      }.`,
      type: 'success',
    });
  }

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
      templateParams: { status: updated.status, identifier: updated.identifier },
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

// CORRECCIÓN 27/29: backfill idempotente — crea únicamente las subcuentas
// faltantes hasta llegar a 20, nunca duplica las existentes. Útil para
// clientes dados de alta antes de esta actualización.
const ensureSubaccounts = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const created = await ensureAllSubaccounts(client.id);
  res.json({ ok: true, createdCount: created.length });
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
    templateParams: { amount: String(report.amount), status },
  });

  res.json({ ok: true, report: updated });
});

// AUDITORÍA QLC PARTE 9 — cola de solicitudes de subcuenta/API pendientes
// (ClientProfile.subaccountRequestedAt), para que el admin las vea en un
// solo lugar sin tener que recorrer cliente por cliente. Muestra también
// cuántas subcuentas ocultas tiene disponibles para revelar.
const listPendingSubaccountRequests = asyncHandler(async (req, res) => {
  const clients = await prisma.clientProfile.findMany({
    where: { subaccountRequestedAt: { not: null } },
    orderBy: { subaccountRequestedAt: 'asc' },
    include: {
      user: { select: { email: true } },
      apiSubaccounts: {
        where: { isPrincipal: false, visibleToClient: false },
        orderBy: { slotIndex: 'asc' },
        select: { id: true, slotIndex: true, identifier: true },
      },
    },
  });
  res.json({
    ok: true,
    requests: clients.map((c) => ({
      clientId: c.id,
      username: c.username,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.user?.email,
      requestedAt: c.subaccountRequestedAt,
      nextHiddenSubaccount: c.apiSubaccounts[0] || null,
      hiddenCount: c.apiSubaccounts.length,
    })),
  });
});

// El admin puede rechazar la solicitud sin revelar ninguna subcuenta —
// nunca cambia visibleToClient, solo limpia la marca de "pendiente" y avisa
// al cliente.
const rejectSubaccountRequest = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (!client.subaccountRequestedAt) {
    throw ApiError.conflict('Este cliente no tiene una solicitud de subcuenta pendiente.');
  }

  await prisma.clientProfile.update({ where: { id: client.id }, data: { subaccountRequestedAt: null } });
  await notifyClient(client.id, {
    title: 'Solicitud de subcuenta rechazada',
    message: 'QLC revisó tu solicitud de subcuenta adicional y, por ahora, no fue posible habilitarla. Contacta a soporte si necesitas más información.',
    type: 'warning',
    templateKey: 'subaccount_request_rejected',
  });

  res.json({ ok: true });
});

module.exports = {
  createSubaccount,
  updateSubaccount,
  getSubaccountSecrets,
  ensureSubaccounts,
  listCapitalDistributionReports,
  reviewCapitalDistributionReport,
  listPendingSubaccountRequests,
  rejectSubaccountRequest,
  MAX_SUBACCOUNTS_PER_CLIENT,
};
