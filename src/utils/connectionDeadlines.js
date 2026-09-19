/*
 * CORRECCIÓN 25 — si un estado de cuenta generó una comisión con un plazo
 * de 72h y ese plazo ya venció sin que el pago fuera reportado/validado,
 * la conexión API de la subcuenta se desactiva automáticamente. No hay
 * infraestructura de cron en este proyecto, así que la verificación se
 * ejecuta de forma perezosa cada vez que se consulta la subcuenta (admin o
 * cliente) — funcionalmente equivalente y sin dependencias nuevas.
 */
const prisma = require('../config/prisma');
const { notifyClient, notifyAdmins } = require('./notify');

// Umbral de aviso anticipado ("quedan pocas horas") antes del vencimiento.
const WARNING_THRESHOLD_HOURS = 24;

// Aviso de "quedan pocas horas" — mismo chequeo perezoso, se dispara una
// sola vez por estado de cuenta (commissionWarningSentAt evita repetirlo en
// cada lectura) mientras todavía no se cumple el plazo.
async function warnCommissionDeadlineApproaching(apiSubaccountId) {
  const now = new Date();
  const threshold = new Date(now.getTime() + WARNING_THRESHOLD_HOURS * 60 * 60 * 1000);

  const approaching = await prisma.statement.findFirst({
    where: {
      apiSubaccountId,
      commissionPaid: false,
      commissionWarningSentAt: null,
      commissionDueAt: { gt: now, lte: threshold },
    },
  });
  if (!approaching) return;

  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: apiSubaccountId },
    include: { client: { select: { firstName: true, lastName: true } } },
  });
  if (!subaccount) return;
  const identifier = subaccount.identifier || (subaccount.isPrincipal ? 'PRINCIPAL' : subaccount.id);

  const hoursLeft = Math.max(1, Math.round((new Date(approaching.commissionDueAt) - now) / (60 * 60 * 1000)));

  await prisma.statement.update({
    where: { id: approaching.id },
    data: { commissionWarningSentAt: now },
  });

  await notifyClient(subaccount.clientId, {
    title: 'Tu pago de comisión está por vencer',
    message: `Quedan aproximadamente ${hoursLeft} horas para reportar el pago de la comisión de tu conexión API ${identifier}. Si el plazo vence sin pago, la conexión se desactivará automáticamente.`,
    type: 'warning',
    templateKey: 'statement_deadline_warning',
    templateParams: { identifier, hoursLeft: String(hoursLeft) },
  });

  const clientName = `${subaccount.client?.firstName || ''} ${subaccount.client?.lastName || ''}`.trim();
  await notifyAdmins({
    title: 'Comisión de un cliente está por vencer',
    message: `Quedan aproximadamente ${hoursLeft} horas para que ${clientName || 'un cliente'} (${identifier}) reporte el pago de su comisión, antes de que la conexión API se desactive automáticamente.`,
    type: 'warning',
    templateKey: 'statement_deadline_warning_admin',
    templateParams: { identifier, clientName, hoursLeft: String(hoursLeft) },
  });
}

async function enforceCommissionDeadline(apiSubaccountId) {
  await warnCommissionDeadlineApproaching(apiSubaccountId);

  const overdue = await prisma.statement.findFirst({
    where: {
      apiSubaccountId,
      commissionPaid: false,
      commissionDueAt: { lt: new Date() },
    },
  });
  if (!overdue) return;

  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: apiSubaccountId },
    include: { client: { select: { firstName: true, lastName: true } } },
  });
  if (!subaccount || subaccount.status !== 'CONECTADA') return;

  await prisma.apiSubaccount.update({
    where: { id: apiSubaccountId },
    data: { status: 'DESCONECTADA', disconnectedAt: new Date() },
  });
  await prisma.apiConnectionEvent.create({
    data: { apiSubaccountId, eventType: 'DISCONNECTED' },
  });
  const identifier = subaccount.identifier || (subaccount.isPrincipal ? 'PRINCIPAL' : subaccount.id);

  await notifyClient(subaccount.clientId, {
    title: 'Conexión API desactivada',
    message:
      'El plazo de 72 horas para el pago de la comisión venció sin recibir el pago. La conexión API fue desactivada. Se reactivará una vez que el pago haya sido reportado y validado.',
    type: 'warning',
    templateKey: 'api_connection_auto_disconnected',
    templateParams: { identifier },
  });

  // CORREGIR(2).xlsx CLIENTE 10/16 — el admin también debe enterarse cuando
  // el plazo vence y la API queda desactivada, no solo el cliente.
  const clientName = `${subaccount.client?.firstName || ''} ${subaccount.client?.lastName || ''}`.trim();
  await notifyAdmins({
    title: 'Conexión API desactivada por plazo vencido',
    message: `El plazo de 72 horas para el pago de la comisión de ${clientName || 'un cliente'} (${identifier}) venció sin recibir el pago. Su conexión API fue desactivada automáticamente.`,
    type: 'warning',
    templateKey: 'api_connection_auto_disconnected_admin',
    templateParams: { identifier, clientName },
  });
}

module.exports = { enforceCommissionDeadline };
