/*
 * ESTADO DE CUENTA SIMPLIFICADO — el backend es la única fuente de verdad.
 *
 * Estados (por subcuenta/API, siempre el estado de cuenta MÁS RECIENTE):
 *   NO_GENERADO        → la subcuenta todavía no tiene estado de cuenta.
 *   PENDIENTE_DE_PAGO  → generado por el admin; expiresAt = generatedAt + 72 h.
 *   PAGADO             → el admin confirmó el pago (desaparece el contador).
 *   VENCIDO_SIN_PAGAR  → now >= expiresAt sin pago confirmado.
 *
 * El vencimiento se aplica (a) de forma perezosa en cada lectura y (b) en un
 * barrido periódico del servidor (ver server.js → startStatementExpirySweep),
 * así nunca depende de que el navegador del cliente esté abierto.
 *
 * CORRECCIÓN 25 (se conserva) — si el plazo vence sin pago, la conexión API
 * de la subcuenta se desactiva y se notifica a cliente y administración.
 */
const prisma = require('../config/prisma');
const { notifyClient, notifyAdmins } = require('./notify');

const STATEMENT_DUE_HOURS = 72;
// Umbral de aviso anticipado ("quedan pocas horas") antes del vencimiento.
const WARNING_THRESHOLD_HOURS = 24;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Estado efectivo — cubre el intervalo entre barridos: si ya pasó expiresAt,
// se reporta VENCIDO aunque la fila todavía no se haya actualizado.
function effectiveStatementStatus(statement, now = new Date()) {
  if (!statement) return 'NO_GENERADO';
  if (statement.status === 'PENDIENTE_DE_PAGO' && new Date(statement.expiresAt) <= now) return 'VENCIDO_SIN_PAGAR';
  return statement.status;
}

// Resumen del estado de cuenta ACTUAL de una subcuenta a partir de su lista
// de estados de cuenta (cualquier orden).
function currentStatementSummary(statements = []) {
  const latest = [...statements].sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))[0] || null;
  const status = effectiveStatementStatus(latest);
  return {
    status,
    statementId: latest?.id || null,
    generatedAt: latest?.generatedAt || null,
    // Solo hay contador mientras está PENDIENTE DE PAGO.
    expiresAt: status === 'PENDIENTE_DE_PAGO' ? latest.expiresAt : null,
    paidAt: latest?.paidAt || null,
    hasPdf: Boolean(latest?.pdfDriveFileId),
  };
}

function identifierOf(subaccount) {
  return subaccount.identifier || (subaccount.isPrincipal ? 'PRINCIPAL' : subaccount.id);
}

async function warnDeadlineApproaching(apiSubaccountId) {
  const now = new Date();
  const threshold = new Date(now.getTime() + WARNING_THRESHOLD_HOURS * 60 * 60 * 1000);

  const approaching = await prisma.statement.findFirst({
    where: { apiSubaccountId, status: 'PENDIENTE_DE_PAGO', warningSentAt: null, expiresAt: { gt: now, lte: threshold } },
  });
  if (!approaching) return;

  // Marca atómica: si otra lectura concurrente ya lo marcó, no se repite.
  const claimed = await prisma.statement.updateMany({
    where: { id: approaching.id, warningSentAt: null },
    data: { warningSentAt: now },
  });
  if (claimed.count === 0) return;

  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: apiSubaccountId },
    include: { client: { select: { firstName: true, lastName: true } } },
  });
  if (!subaccount) return;
  const identifier = identifierOf(subaccount);
  const hoursLeft = Math.max(1, Math.round((new Date(approaching.expiresAt) - now) / (60 * 60 * 1000)));

  await notifyClient(subaccount.clientId, {
    title: 'Tu estado de cuenta está por vencer',
    message: `Quedan aproximadamente ${hoursLeft} horas para pagar el estado de cuenta de tu subcuenta/API ${identifier}. Si el plazo vence sin pago, la conexión API se desactivará.`,
    type: 'warning',
    templateKey: 'statement_deadline_warning',
    templateParams: { identifier, hoursLeft: String(hoursLeft), apiSubaccountId },
  });

  const clientName = `${subaccount.client?.firstName || ''} ${subaccount.client?.lastName || ''}`.trim();
  await notifyAdmins({
    title: 'Estado de cuenta de un cliente está por vencer',
    message: `Quedan aproximadamente ${hoursLeft} horas para que ${clientName || 'un cliente'} (${identifier}) pague su estado de cuenta.`,
    type: 'warning',
    templateKey: 'statement_deadline_warning_admin',
    templateParams: { identifier, clientName, hoursLeft: String(hoursLeft), apiSubaccountId, clientId: subaccount.clientId },
  });
}

async function disconnectForOverdue(apiSubaccountId) {
  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: apiSubaccountId },
    include: { client: { select: { firstName: true, lastName: true } } },
  });
  if (!subaccount || subaccount.status !== 'CONECTADA') return;

  const claimed = await prisma.apiSubaccount.updateMany({
    where: { id: apiSubaccountId, status: 'CONECTADA' },
    data: { status: 'DESCONECTADA', disconnectedAt: new Date() },
  });
  if (claimed.count === 0) return;
  await prisma.apiConnectionEvent.create({ data: { apiSubaccountId, eventType: 'DISCONNECTED' } });
  const identifier = identifierOf(subaccount);

  await notifyClient(subaccount.clientId, {
    title: 'Conexión API desactivada',
    message:
      'El plazo de 72 horas para el pago de tu estado de cuenta venció sin recibir el pago. La conexión API fue desactivada. Se reactivará una vez que el pago haya sido reportado y validado.',
    type: 'warning',
    templateKey: 'api_connection_auto_disconnected',
    templateParams: { identifier, apiSubaccountId },
  });

  const clientName = `${subaccount.client?.firstName || ''} ${subaccount.client?.lastName || ''}`.trim();
  await notifyAdmins({
    title: 'Conexión API desactivada por plazo vencido',
    message: `El plazo de 72 horas para el pago del estado de cuenta de ${clientName || 'un cliente'} (${identifier}) venció sin recibir el pago. Su conexión API fue desactivada automáticamente.`,
    type: 'warning',
    templateKey: 'api_connection_auto_disconnected_admin',
    templateParams: { identifier, clientName, apiSubaccountId, clientId: subaccount.clientId },
  });
}

// Chequeo perezoso por subcuenta (se llama al consultar la subcuenta).
async function enforceCommissionDeadline(apiSubaccountId) {
  await warnDeadlineApproaching(apiSubaccountId);

  await prisma.statement.updateMany({
    where: { apiSubaccountId, status: 'PENDIENTE_DE_PAGO', expiresAt: { lte: new Date() } },
    data: { status: 'VENCIDO_SIN_PAGAR' },
  });

  const overdue = await prisma.statement.findFirst({ where: { apiSubaccountId, status: 'VENCIDO_SIN_PAGAR' } });
  if (overdue) await disconnectForOverdue(apiSubaccountId);
}

// Barrido global — vence todo lo que ya pasó su plazo, aunque nadie tenga
// la página abierta, y aplica avisos/desconexión por subcuenta afectada.
async function sweepStatementDeadlines() {
  const now = new Date();
  const threshold = new Date(now.getTime() + WARNING_THRESHOLD_HOURS * 60 * 60 * 1000);
  const affected = await prisma.statement.findMany({
    where: {
      OR: [
        { status: 'PENDIENTE_DE_PAGO', expiresAt: { lte: threshold } },
        { status: 'VENCIDO_SIN_PAGAR', apiSubaccount: { status: 'CONECTADA' } },
      ],
    },
    select: { apiSubaccountId: true },
    distinct: ['apiSubaccountId'],
  });
  for (const { apiSubaccountId } of affected) {
    await enforceCommissionDeadline(apiSubaccountId);
  }
}

function startStatementExpirySweep() {
  const run = () => sweepStatementDeadlines().catch((err) => console.error('[statements] Error en barrido de vencimientos:', err.message));
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  STATEMENT_DUE_HOURS,
  effectiveStatementStatus,
  currentStatementSummary,
  enforceCommissionDeadline,
  sweepStatementDeadlines,
  startStatementExpirySweep,
};
