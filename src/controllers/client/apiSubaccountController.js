const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { encrypt } = require('../../utils/crypto');
const { enforceCommissionDeadline } = require('../../utils/connectionDeadlines');
const { isValidIp } = require('../../utils/ipValidation');
const { notifyAdmins } = require('../../utils/notify');

// CORRECCIÓN (subcuentas ocultas) — de las 20 subcuentas pre-creadas al
// registro, el cliente solo ve la PRINCIPAL y las que un admin ya reveló
// (visibleToClient=true). Mismo filtro en listMine/getMine para que una
// subcuenta oculta tampoco sea accesible adivinando su URL/id.
const VISIBLE_TO_CLIENT_WHERE = { OR: [{ isPrincipal: true }, { visibleToClient: true }] };

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
  const preCheck = await prisma.apiSubaccount.findMany({ where: { clientId }, select: { id: true } });
  await Promise.all(preCheck.map((s) => enforceCommissionDeadline(s.id)));

  const [subaccounts, hiddenCount, client] = await Promise.all([
    prisma.apiSubaccount.findMany({
      where: { clientId, ...VISIBLE_TO_CLIENT_WHERE },
      orderBy: { slotIndex: 'asc' },
      include: {
        clientModel: { include: { model: true } },
        process: { include: { conditions: true } },
      },
    }),
    prisma.apiSubaccount.count({ where: { clientId, isPrincipal: false, visibleToClient: false } }),
    prisma.clientProfile.findUnique({ where: { id: clientId }, select: { subaccountRequestedAt: true } }),
  ]);
  res.json({
    ok: true,
    subaccounts: subaccounts.map(shape),
    hiddenCount,
    requestPending: Boolean(client?.subaccountRequestedAt),
  });
});

// CORRECCIÓN (subcuentas ocultas) — el cliente ya no puede pedir una
// subcuenta "nueva" (las 20 ya existen desde el registro): esto solo avisa
// al equipo QLC para que revele manualmente una de las ocultas.
const requestAdditionalSubaccount = asyncHandler(async (req, res) => {
  const clientId = req.clientProfile.id;
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId } });
  if (client.subaccountRequestedAt) {
    throw ApiError.conflict('Ya tienes una solicitud pendiente de revisión por el equipo de QLC.');
  }

  const hiddenCount = await prisma.apiSubaccount.count({
    where: { clientId, isPrincipal: false, visibleToClient: false },
  });
  if (hiddenCount === 0) {
    throw ApiError.conflict('Ya tienes disponibles todas tus subcuentas.');
  }

  await prisma.clientProfile.update({ where: { id: clientId }, data: { subaccountRequestedAt: new Date() } });
  await notifyAdmins({
    title: 'Solicitud de nueva subcuenta',
    message: `${client.firstName} ${client.lastName} solicitó que se le habilite una subcuenta adicional.`,
    type: 'info',
  });

  res.json({ ok: true });
});

const getMine = asyncHandler(async (req, res) => {
  await enforceCommissionDeadline(req.params.id);
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...VISIBLE_TO_CLIENT_WHERE },
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
    where: { id: req.params.id, clientId: req.clientProfile.id },
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
    where: { id: req.params.id, clientId: req.clientProfile.id },
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
    where: { id: req.params.id, clientId: req.clientProfile.id },
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

  res.status(201).json({ ok: true, report });
});

const listCapitalDistributionReports = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
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
    where: { id: req.params.id, clientId: req.clientProfile.id },
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
    where: { id: req.params.id, clientId: req.clientProfile.id },
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

module.exports = {
  listMine,
  requestAdditionalSubaccount,
  getMine,
  updateMine,
  reportCapitalReady,
  reportCapitalDistribution,
  listCapitalDistributionReports,
  selectModel,
  confirmModel,
};
