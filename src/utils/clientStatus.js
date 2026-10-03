/*
 * ESTADO DEL CLIENTE — se calcula con los datos REALES de sus cuentas, nunca
 * se deja como un dato "suelto" que pueda quedar desactualizado:
 *   INACTIVE → el acceso del cliente está desactivado.
 *   ACTIVE   → tiene al menos una subcuenta vigente ACTIVADA por QLC.
 *   REVIEW   → se le desactivó una cuenta y quedó en revisión (sin activas).
 *   PENDING  → todavía no tiene ninguna cuenta activada.
 * Antes, reactivar el acceso del cliente lo marcaba "ACTIVA" aunque no
 * tuviera ninguna cuenta activada; eso ya no ocurre.
 */
const prisma = require('../config/prisma');

function computeClientStatus({ userIsActive, storedStatus, subaccounts }) {
  if (userIsActive === false) return 'INACTIVE';
  const activated = (subaccounts || []).some((s) => !s.deactivatedAt && s.process?.isActivated);
  if (activated) return 'ACTIVE';
  return storedStatus === 'REVIEW' ? 'REVIEW' : 'PENDING';
}

// Recalcula y guarda el estado del cliente (llamar después de activar o
// desactivar una cuenta, o de cambiar su acceso).
async function syncClientStatus(clientId, db = prisma) {
  const client = await db.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      status: true,
      user: { select: { isActive: true } },
      apiSubaccounts: { select: { deactivatedAt: true, process: { select: { isActivated: true } } } },
    },
  });
  if (!client) return null;
  const status = computeClientStatus({ userIsActive: client.user?.isActive, storedStatus: client.status, subaccounts: client.apiSubaccounts });
  if (status !== client.status) await db.clientProfile.update({ where: { id: clientId }, data: { status } });
  return status;
}

module.exports = { computeClientStatus, syncClientStatus };
