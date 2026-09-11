const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { encrypt, decrypt } = require('../utils/crypto');
const { notifyClient } = require('../utils/notify');
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
});

const updateSubaccount = asyncHandler(async (req, res) => {
  const data = updateSubaccountSchema.parse(req.body);
  const existing = await prisma.apiSubaccount.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');

  if (data.identifier && data.identifier !== existing.identifier) {
    const clash = await prisma.apiSubaccount.findUnique({ where: { identifier: data.identifier } });
    if (clash) throw ApiError.conflict('Ese identificador ya está en uso por otra subcuenta.');
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

module.exports = {
  createSubaccount,
  updateSubaccount,
  getSubaccountSecrets,
  ensureSubaccounts,
  listCapitalDistributionReports,
  reviewCapitalDistributionReport,
  MAX_SUBACCOUNTS_PER_CLIENT,
};
