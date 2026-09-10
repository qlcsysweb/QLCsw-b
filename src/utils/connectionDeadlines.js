/*
 * CORRECCIÓN 25 — si un estado de cuenta generó una comisión con un plazo
 * de 72h y ese plazo ya venció sin que el pago fuera reportado/validado,
 * la conexión API de la subcuenta se desactiva automáticamente. No hay
 * infraestructura de cron en este proyecto, así que la verificación se
 * ejecuta de forma perezosa cada vez que se consulta la subcuenta (admin o
 * cliente) — funcionalmente equivalente y sin dependencias nuevas.
 */
const prisma = require('../config/prisma');
const { notifyClient } = require('./notify');

async function enforceCommissionDeadline(apiSubaccountId) {
  const overdue = await prisma.statement.findFirst({
    where: {
      apiSubaccountId,
      commissionPaid: false,
      commissionDueAt: { lt: new Date() },
    },
  });
  if (!overdue) return;

  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: apiSubaccountId } });
  if (!subaccount || subaccount.status !== 'CONECTADA') return;

  await prisma.apiSubaccount.update({
    where: { id: apiSubaccountId },
    data: { status: 'DESCONECTADA', disconnectedAt: new Date() },
  });
  await prisma.apiConnectionEvent.create({
    data: { apiSubaccountId, eventType: 'DISCONNECTED' },
  });
  await notifyClient(subaccount.clientId, {
    title: 'Conexión API desactivada',
    message:
      'El plazo de 72 horas para el pago de la comisión venció sin recibir el pago. La conexión API fue desactivada. Se reactivará una vez que el pago haya sido reportado y validado.',
    type: 'warning',
    templateKey: 'api_connection_auto_disconnected',
    templateParams: { identifier: subaccount.identifier },
  });
}

module.exports = { enforceCommissionDeadline };
