/*
 * SINCRONÍA "Conexión API" — el paso API del proceso de activación y el estado
 * de la conexión de la subcuenta deben decir lo mismo (antes, rechazar el paso
 * dejaba la subcuenta en CONECTADA y la ficha del cliente no cambiaba).
 *
 *   paso API CONFIRMED  ↔  conexión CONECTADA
 *   paso API REJECTED   ↔  conexión DESCONECTADA
 *   paso API PENDING    ↔  conexión PENDIENTE
 *
 * Cada cambio real de conexión queda en el historial (ApiConnectionEvent).
 */
const prisma = require('../config/prisma');

const STATUS_BY_CONDITION = { CONFIRMED: 'CONECTADA', REJECTED: 'DESCONECTADA', PENDING: 'PENDIENTE' };
const CONDITION_BY_STATUS = { CONECTADA: 'CONFIRMED', DESCONECTADA: 'REJECTED', PENDIENTE: 'PENDING' };

// Registra el evento de historial de un cambio de conexión (la primera
// conexión es ACTIVATED; las siguientes, RECONNECTED).
async function recordConnectionEvent(apiSubaccountId, newStatus, reason) {
  let eventType = 'DISCONNECTED';
  if (newStatus === 'CONECTADA') {
    const prior = await prisma.apiConnectionEvent.count({
      where: { apiSubaccountId, eventType: { in: ['ACTIVATED', 'RECONNECTED'] } },
    });
    eventType = prior === 0 ? 'ACTIVATED' : 'RECONNECTED';
  } else if (newStatus === 'PENDIENTE') {
    return; // sin evento: ni conexión ni desconexión
  }
  await prisma.apiConnectionEvent.create({ data: { apiSubaccountId, eventType, reason: reason || null } });
}

// El ADMIN cambió el paso API del proceso → se ajusta la conexión.
async function syncConnectionFromCondition(apiSubaccountId, conditionStatus, userId) {
  const target = STATUS_BY_CONDITION[conditionStatus];
  if (!target) return null;
  const sub = await prisma.apiSubaccount.findUnique({ where: { id: apiSubaccountId }, select: { status: true } });
  if (!sub || sub.status === target) return null;
  const updated = await prisma.apiSubaccount.update({
    where: { id: apiSubaccountId },
    data: {
      status: target,
      ...(target === 'DESCONECTADA' ? { disconnectedAt: new Date() } : {}),
      ...(target === 'CONECTADA' ? { reconnectedAt: new Date() } : {}),
      ...(userId ? { updatedByUserId: userId } : {}),
    },
  });
  await recordConnectionEvent(apiSubaccountId, target, 'Actualizado desde el proceso de activación (paso Conexión API).');
  return updated;
}

// El ADMIN cambió el estado de la conexión → se ajusta el paso API del proceso.
async function syncConditionFromConnection(apiSubaccountId, connectionStatus) {
  const target = CONDITION_BY_STATUS[connectionStatus];
  if (!target) return;
  const process = await prisma.process.findUnique({ where: { apiSubaccountId } });
  if (!process) return;
  await prisma.processCondition.updateMany({
    where: { processId: process.id, type: 'API', status: { not: target } },
    data: { status: target },
  });
}

module.exports = { recordConnectionEvent, syncConnectionFromCondition, syncConditionFromConnection };
