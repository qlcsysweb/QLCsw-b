const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { encrypt } = require('../../utils/crypto');
const { enforceCommissionDeadline, currentStatementSummary } = require('../../utils/connectionDeadlines');
const { isValidIp } = require('../../utils/ipValidation');
const { notifyAdmins } = require('../../utils/notify');
const { MAX_SUBACCOUNTS_PER_CLIENT } = require('../../utils/subaccountProvisioning');
const subaccountRequestService = require('../../services/subaccountRequestService');
const {
  FINAL_CAPITAL_STATUSES,
  isCurrentCapitalReport,
  latestCapitalReport,
  lockCapitalSubaccount,
} = require('../../utils/capitalDistribution');

// GESTIÓN DINÁMICA DE SUBCUENTAS — subcuentas por ESTADO: toda subcuenta sin
// deactivatedAt es, por definición, ACTIVA y visible para su cliente. Una
// subcuenta INACTIVA nunca se borra (conserva su historial), pero tampoco es
// accesible para el cliente ni adivinando su URL/id.
const ACTIVE_WHERE = { deactivatedAt: null };
// Capital operativo mínimo de QLC: se usa cuando el ADMIN no asignó un monto
// propio a la subcuenta (mismo valor que muestra el panel del cliente).
const DEFAULT_REQUIRED_CAPITAL = 100;

// Lo que ve el CLIENTE de su subcuenta: nunca las claves cifradas. El código
// PCB que QLC asigna al registrar la API (ej. PCB-1-A-1) se muestra como `pcb`
// (QLC Affiliate Program §1/§15: el PCB coincide en cliente, afiliado y admin).
function shape(subaccount) {
  // eslint-disable-next-line no-unused-vars
  const { apiKeyEncrypted, apiSecretEncrypted, apiPassphraseEncrypted, identifier, ...rest } = subaccount;
  return {
    ...rest,
    pcb: identifier || null,
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
        process: { include: { conditions: { where: { type: { not: 'WALLET' } } } } },
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
      process: { include: { conditions: { where: { type: { not: 'WALLET' } } } } },
      paymentReports: { orderBy: { reportedAt: 'desc' } },
      statements: { where: { status: { not: 'BORRADOR' } }, orderBy: { generatedAt: 'desc' } },
      connectionEvents: { where: { hiddenAt: null }, orderBy: { occurredAt: 'desc' } },
    },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (subaccount.deactivatedAt) {
    throw ApiError.gone('Esta subcuenta fue desactivada por administración. Su historial sigue disponible, pero ya no puede operarse.', {
      code: 'SUBACCOUNT_DEACTIVATED',
      deactivatedAt: subaccount.deactivatedAt,
    });
  }
  res.json({ ok: true, subaccount: { ...shape(subaccount), statementSummary: currentStatementSummary(subaccount.statements) } });
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
//
// CONFIRMACIÓN ESCRITA OBLIGATORIA — el cliente escribe UNA de las dos
// declaraciones FIJAS autorizadas (ES o EN). El monto NO va en la frase: el
// capital operativo requerido lo fija el ADMIN y se lee SIEMPRE de la BD
// (nunca del body). Es una DECLARACIÓN del cliente: QLC no consulta el
// exchange. Solo se toleran espacios extra y mayúsculas/minúsculas.
const reportCapitalDistributionSchema = z.object({
  confirmation: z.string({ required_error: 'Escribe la frase de confirmación.' }).max(200),
  note: z.string().max(500).optional(),
});

// Frases autorizadas — idénticas a las que muestra el panel del cliente
// (frontend/src/modules/client/CapitalConfirmation.jsx).
const CAPITAL_DECLARATIONS = {
  ES: 'CONFIRMO QUE DISPONGO DEL SALDO REQUERIDO EN MI CUENTA',
  EN: 'I CONFIRM THAT I HAVE THE REQUIRED BALANCE IN MY ACCOUNT',
};

const normalizePhrase = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();

// 'ES' | 'EN' según la declaración escrita, o null si no es ninguna de las dos.
function declarationLanguage(text) {
  const normalized = normalizePhrase(text);
  return Object.keys(CAPITAL_DECLARATIONS).find((lang) => CAPITAL_DECLARATIONS[lang] === normalized) || null;
}

const reportCapitalDistribution = asyncHandler(async (req, res) => {
  const { confirmation, note } = reportCapitalDistributionSchema.parse(req.body);
  // Subcuenta del cliente autenticado (protección IDOR: nunca la de otro).
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  // Si el ADMIN no asignó un monto a la subcuenta, aplica el capital mínimo
  // de QLC (100 USDT). Siempre se lee de la BD / constante, nunca del body.
  const requiredCapital =
    subaccount.requiredCapital != null && Number(subaccount.requiredCapital) > 0 ? subaccount.requiredCapital : DEFAULT_REQUIRED_CAPITAL;

  const confirmationLanguage = declarationLanguage(confirmation);
  if (!confirmationLanguage) {
    throw ApiError.badRequest('La frase de confirmación no coincide con ninguna de las declaraciones indicadas.');
  }

  // UNA confirmación vigente por requerimiento de capital (ver
  // utils/capitalDistribution). Búsqueda + INSERT dentro de una transacción
  // con bloqueo por subcuenta: un doble clic, un reintento o dos requests
  // casi simultáneos nunca crean dos registros — el segundo recibe el mismo
  // registro vigente (respuesta idempotente, sin notificar otra vez).
  const { report, created } = await prisma.$transaction(async (tx) => {
    await lockCapitalSubaccount(tx, subaccount.id);
    const latest = await latestCapitalReport(tx, subaccount.id);
    if (isCurrentCapitalReport(latest, requiredCapital)) return { report: latest, created: false };
    const inserted = await tx.capitalDistributionReport.create({
      data: {
        apiSubaccountId: subaccount.id,
        amount: requiredCapital,
        // Declaración autorizada (forma canónica) + idioma que usó el cliente.
        declaration: CAPITAL_DECLARATIONS[confirmationLanguage],
        confirmationLanguage,
        note: note || null,
        status: 'PENDING',
      },
    });
    return { report: inserted, created: true };
  });
  if (!created) return res.json({ ok: true, report, alreadyReported: true });

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

  const [reports, latest] = await Promise.all([
    prisma.capitalDistributionReport.findMany({
      where: { apiSubaccountId: subaccount.id, clientHiddenAt: null },
      orderBy: { reportedAt: 'desc' },
    }),
    latestCapitalReport(prisma, subaccount.id),
  ]);
  // Registro VIGENTE (si existe): el panel lo muestra en lugar del
  // formulario vacío, aunque el cliente lo haya quitado de su historial.
  const requiredCapital =
    subaccount.requiredCapital != null && Number(subaccount.requiredCapital) > 0 ? subaccount.requiredCapital : DEFAULT_REQUIRED_CAPITAL;
  const current = isCurrentCapitalReport(latest, requiredCapital) ? latest : null;
  res.json({ ok: true, reports, current });
});

// BORRAR DEL HISTORIAL (cliente) — solo reportes ya revisados por QLC
// (aprobados o rechazados); uno en revisión no se puede quitar. Se oculta
// únicamente para el cliente: el admin conserva el registro completo.
const hideCapitalDistributionReport = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, ...ACTIVE_WHERE },
    select: { id: true },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  const report = await prisma.capitalDistributionReport.findFirst({
    where: { id: req.params.reportId, apiSubaccountId: subaccount.id, clientHiddenAt: null },
    select: { id: true, status: true },
  });
  if (!report) throw ApiError.notFound('Reporte no encontrado');
  if (!FINAL_CAPITAL_STATUSES.includes(report.status)) {
    throw ApiError.badRequest('Este reporte sigue en revisión; podrás borrarlo cuando QLC lo revise.');
  }
  await prisma.capitalDistributionReport.update({ where: { id: report.id }, data: { clientHiddenAt: new Date() } });
  res.json({ ok: true });
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
  hideCapitalDistributionReport,
};
