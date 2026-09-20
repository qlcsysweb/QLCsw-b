const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { encrypt } = require('../../utils/crypto');
const { enforceCommissionDeadline } = require('../../utils/connectionDeadlines');
const { isValidIp } = require('../../utils/ipValidation');
const { notifyAdmins } = require('../../utils/notify');
const { MAX_SUBACCOUNTS_PER_CLIENT } = require('../../utils/subaccountProvisioning');
const subaccountRequestService = require('../../services/subaccountRequestService');

// GESTIÓN DINÁMICA DE SUBCUENTAS — subcuentas por ESTADO: toda subcuenta sin
// deactivatedAt es, por definición, ACTIVA y visible para su cliente. Una
// subcuenta INACTIVA nunca se borra (conserva su historial), pero tampoco es
// accesible para el cliente ni adivinando su URL/id.
const ACTIVE_WHERE = { deactivatedAt: null };

function shape(subaccount) {
  const { apiKeyEncrypted, apiSecretEncrypted, apiPassphraseEncrypted, ...rest } = subaccount;
  return {
    ...rest,
    hasApiKey: Boolean(apiKeyEncrypted),
    hasApiSecret: Boolean(apiSecretEncrypted),
    hasApiPassphrase: Boolean(apiPassphraseEncrypted),
  };
}

const listMine = asyncHandler(async (req, res) => {
  const clientId = req.clientProfile.id;
  const preCheck = await prisma.apiSubaccount.findMany({ where: { clientId, ...ACTIVE_WHERE }, select: { id: true } });
  await Promise.all(preCheck.map((s) => enforceCommissionDeadline(s.id)));

  const [subaccounts, activeCount, requests] = await Promise.all([
    prisma.apiSubaccount.findMany({
      where: { clientId, ...ACTIVE_WHERE },
      orderBy: { slotIndex: 'asc' },
      include: {
        clientModel: { include: { model: true } },
        process: { include: { conditions: true } },
      },
    }),
    prisma.apiSubaccount.count({ where: { clientId, isPrincipal: false, ...ACTIVE_WHERE } }),
    subaccountRequestService.listRequestsForClient(clientId),
  ]);
  res.json({
    ok: true,
    subaccounts: subaccounts.map(shape),
    activeCount,
    maxSubaccounts: MAX_SUBACCOUNTS_PER_CLIENT,
    requests,
  });
});

const requestSchema = z.object({ reason: z.string().max(500).optional() });

// El cliente nunca crea una subcuenta directamente — solo solicita, y el
// admin decide si la aprueba (ver subaccountRequestService).
const requestNewSubaccount = asyncHandler(async (req, res) => {
  const { reason } = requestSchema.parse(req.body || {});
  const request = await subaccountRequestService.requestCreateSubaccount({
    clientId: req.clientProfile.id,
    reason,
    requestedByUserId: req.user.id,
  });
  res.status(201).json({ ok: true, request });
});

const requestDeactivateSchema = z.object({ reason: z.string().max(500).optional() });

// El cliente tampoco desactiva directamente: solicita, y el admin aprueba o
// rechaza. Se bloquea aquí mismo (antes de llegar al admin) si la subcuenta
// tiene un estado de cuenta con comisión pendiente de pago.
const requestDeactivateSubaccount = asyncHandler(async (req, res) => {
  const { reason } = requestDeactivateSchema.parse(req.body || {});
  const request = await subaccountRequestService.requestDeactivateSubaccount({
    clientId: req.clientProfile.id,
    apiSubaccountId: req.params.id,
    reason,
    requestedByUserId: req.user.id,
  });
  res.status(201).json({ ok: true, request });
});

const getMine = asyncHandler(async (req, res) => {
  await enforceCommissionDeadline(req.params.id);
  // Ojo: aquí NO se filtra por ACTIVE_WHERE — necesitamos saber si la
  // subcuenta existe y es del cliente para poder distinguir "desactivada"
  // (respuesta controlada 410, el cliente puede seguir viendo su propio
  // historial) de "no existe / es de otro cliente" (404 genérico, protección
  // IDOR: nunca revelamos si el id pertenece a alguien más).
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
    include: {
      clientModel: { include: { model: true } },
      process: { include: { conditions: true } },
      paymentReports: { orderBy: { reportedAt: 'desc' } },
      statements: { orderBy: { createdAt: 'desc' } },
      connectionEvents: { orderBy: { occurredAt: 'desc' } },
      capitalDistributionItems: true,
    },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (subaccount.deactivatedAt) {
    throw ApiError.gone('Esta subcuenta fue desactivada por administración. Su historial sigue disponible, pero ya no puede operarse.', {
      code: 'SUBACCOUNT_DEACTIVATED',
      deactivatedAt: subaccount.deactivatedAt,
    });
  }
  res.json({ ok: true, subaccount: shape(subaccount) });
});

const updateSchema = z.object({
  exchangeName: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
  apiPassphrase: z.string().min(1).optional(),
  // CORRECCIÓN 18 (bloque de 20) — el cliente puede declarar su propia IP
  // únicamente cuando el admin ya marcó ipRequired=true en esta subcuenta;
  // "ipRequired" en sí NUNCA lo puede cambiar el cliente (ver abajo).
  ipAddress: z.string().min(1).optional(),
});

// El cliente NUNCA puede fijar su propio "status" (CORRECCIÓN 10): eso es
// exclusivamente administrativo/visual, tras revisión manual del equipo.
const updateMine = asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  if (!data.exchangeName && !data.apiKey && !data.apiSecret && !data.apiPassphrase && data.ipAddress === undefined) {
    throw ApiError.badRequest('Debes indicar al menos un dato para actualizar');
  }

  const existing = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
  });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');

  if (data.ipAddress !== undefined) {
    if (!existing.ipRequired) {
      throw ApiError.badRequest('Esta subcuenta no requiere IP.');
    }
    if (!isValidIp(data.ipAddress)) {
      throw ApiError.badRequest('La IP no tiene un formato válido.');
    }
  }

  const updated = await prisma.apiSubaccount.update({
    where: { id: existing.id },
    data: {
      ...(data.exchangeName ? { exchangeName: data.exchangeName } : {}),
      ...(data.apiKey ? { apiKeyEncrypted: encrypt(data.apiKey) } : {}),
      ...(data.apiSecret ? { apiSecretEncrypted: encrypt(data.apiSecret) } : {}),
      ...(data.apiPassphrase ? { apiPassphraseEncrypted: encrypt(data.apiPassphrase) } : {}),
      ...(data.ipAddress !== undefined ? { ipAddress: data.ipAddress } : {}),
      updatedByUserId: req.user.id,
    },
  });

  res.json({ ok: true, subaccount: shape(updated) });
});

// CORRECCIÓN 10: el cliente solo puede INFORMAR que ya tiene el capital
// operativo requerido — la validación real siempre es manual, vía la
// plataforma externa de QLC.
const reportCapitalReady = asyncHandler(async (req, res) => {
  const existing = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
  });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');

  const updated = await prisma.apiSubaccount.update({
    where: { id: existing.id },
    data: { clientReportedCapitalReady: true, clientReportedCapitalAt: new Date() },
  });

  const process = await prisma.process.findUnique({ where: { apiSubaccountId: existing.id } });
  if (process) {
    await prisma.processCondition.updateMany({
      where: { processId: process.id, type: 'FUNDS' },
      data: { status: 'CONFIRMED' },
    });
  }

  res.json({ ok: true, subaccount: shape(updated) });
});

// CORREGIR.xlsx CLIENTE 13 — reporte real de distribución de capital
// ("YA DISTRIBUÍ MI CAPITAL"), con el mismo patrón que los reportes de
// pago: el cliente confirma que ya distribuyó, QLC revisa y aprueba/rechaza.
// El sistema NUNCA se conecta al exchange para validar el saldo.
//
// CORRECCIÓN (monto no editable por el cliente) — el monto reportado ya NO
// lo escribe el cliente: siempre es el capital operativo requerido que fijó
// el admin (requiredCapital). El cliente solo confirma + agrega una nota.
const reportCapitalDistributionSchema = z.object({
  note: z.string().max(500).optional(),
});

const reportCapitalDistribution = asyncHandler(async (req, res) => {
  const { note } = reportCapitalDistributionSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (subaccount.requiredCapital == null) {
    throw ApiError.badRequest('QLC todavía no configuró el capital operativo requerido para esta subcuenta.');
  }

  const report = await prisma.capitalDistributionReport.create({
    data: {
      apiSubaccountId: subaccount.id,
      amount: subaccount.requiredCapital,
      note: note || null,
      status: 'PENDING',
    },
  });

  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  await notifyAdmins({
    title: 'Distribución de capital reportada',
    message: `${client.firstName} ${client.lastName} reportó que ya distribuyó ${report.amount} USDT${subaccount.identifier ? ` en la subcuenta/API ${subaccount.identifier}` : ''}.`,
    type: 'info',
    templateKey: 'capital_distribution_reported',
    templateParams: {
      clientName: `${client.firstName} ${client.lastName}`,
      amount: String(report.amount),
      apiSubaccountId: subaccount.id,
      clientId: req.clientProfile.id,
    },
  });

  res.status(201).json({ ok: true, report });
});

const listCapitalDistributionReports = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const reports = await prisma.capitalDistributionReport.findMany({
    where: { apiSubaccountId: subaccount.id },
    orderBy: { reportedAt: 'desc' },
  });
  res.json({ ok: true, reports });
});

const selectModelSchema = z.object({ modelId: z.string().min(1) });

const selectModel = asyncHandler(async (req, res) => {
  const { modelId } = selectModelSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const model = await prisma.model.findUnique({ where: { id: modelId } });
  if (!model || !model.isActive) throw ApiError.badRequest('Modelo no válido');

  const existing = await prisma.clientModel.findUnique({ where: { apiSubaccountId: subaccount.id } });
  if (existing?.confirmedAt) {
    throw ApiError.conflict('Ya confirmaste un modelo para esta subcuenta. Contacta con QLC para cambiarlo.');
  }

  const clientModel = await prisma.clientModel.upsert({
    where: { apiSubaccountId: subaccount.id },
    update: { modelId: model.id },
    create: { apiSubaccountId: subaccount.id, modelId: model.id },
    include: { model: true },
  });

  res.json({ ok: true, clientModel });
});

// El contrato ya no forma parte del flujo: confirmar el modelo únicamente
// marca clientModel.confirmedAt. La autorización legal de la operación ya
// se obtuvo en el registro (Aviso de Privacidad + Términos y Condiciones).
const confirmModel = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const clientModel = await prisma.clientModel.findUnique({
    where: { apiSubaccountId: subaccount.id },
    include: { model: true },
  });
  if (!clientModel) throw ApiError.badRequest('Todavía no has seleccionado un modelo.');
  if (clientModel.confirmedAt) throw ApiError.conflict('Ya confirmaste este modelo.');

  const confirmed = await prisma.clientModel.update({
    where: { id: clientModel.id },
    data: { confirmedAt: new Date() },
    include: { model: true },
  });

  res.json({ ok: true, clientModel: confirmed });
});

const listMyRequests = asyncHandler(async (req, res) => {
  const requests = await subaccountRequestService.listRequestsForClient(req.clientProfile.id);
  res.json({ ok: true, requests });
});

module.exports = {
  listMine,
  requestNewSubaccount,
  requestDeactivateSubaccount,
  listMyRequests,
  getMine,
  updateMine,
  reportCapitalReady,
  reportCapitalDistribution,
  listCapitalDistributionReports,
  selectModel,
  confirmModel,
};
