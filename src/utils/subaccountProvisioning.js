/*
 * GESTIÓN DINÁMICA DE SUBCUENTAS/API — cada cliente nace con únicamente su
 * cuenta PRINCIPAL (slotIndex 0). Ya NO se pre-crean 20 subcuentas por
 * cliente: cualquier subcuenta adicional nace solo cuando un admin la crea
 * manualmente o aprueba una solicitud del cliente (ver
 * services/subaccountRequestService.js).
 */
const prisma = require('../config/prisma');

// CORREGIR(2).xlsx — el contrato ya NO es un requisito de activación (se
// sustituyó por la aceptación de Términos y Condiciones en el registro).
// Orden alineado al flujo real del cliente: Wallet/API → Garantía (PAYMENT,
// mínimo 10% del capital) → Capital distribuido en el exchange (FUNDS) →
// Activación.
const PROCESS_CONDITION_TYPES = ['WALLET', 'PAYMENT', 'FUNDS', 'API', 'ACTIVATION'];
const MAX_SUBACCOUNTS_PER_CLIENT = 20;

function buildProcessCreateData(clientHasWallet) {
  return {
    create: {
      conditions: {
        create: PROCESS_CONDITION_TYPES.map((type) => ({
          type,
          status: type === 'WALLET' && clientHasWallet ? 'CONFIRMED' : 'PENDING',
        })),
      },
    },
  };
}

// Idempotente: si el cliente ya tiene su cuenta PRINCIPAL (slotIndex 0), no
// hace nada. Se usa en el registro público y en la creación administrativa
// de clientes — nunca crea subcuentas numeradas adicionales.
async function ensurePrincipalSubaccount(clientId) {
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId } });
  if (!client) return null;

  const existingPrincipal = await prisma.apiSubaccount.findUnique({
    where: { clientId_slotIndex: { clientId, slotIndex: 0 } },
  });
  if (existingPrincipal) return existingPrincipal;

  return prisma.apiSubaccount.create({
    data: {
      clientId,
      slotIndex: 0,
      isPrincipal: true,
      process: buildProcessCreateData(Boolean(client.walletAddress)),
    },
  });
}

// Próximo slotIndex disponible para una subcuenta NUMERADA (1..20) nueva de
// este cliente. Se basa en el máximo slotIndex ya usado (incluyendo
// subcuentas inactivas/históricas) para nunca chocar con la restricción
// única [clientId, slotIndex] — el slotIndex es solo un orden interno, el
// identificador visible para el cliente/admin es `identifier`.
async function getNextSlotIndex(clientId) {
  const last = await prisma.apiSubaccount.findFirst({
    where: { clientId, isPrincipal: false },
    orderBy: { slotIndex: 'desc' },
    select: { slotIndex: true },
  });
  return (last?.slotIndex || 0) + 1;
}

// Cuenta contra el límite de 20 — únicamente las subcuentas numeradas
// ACTIVAS (ni la principal ni las inactivas cuentan).
async function countActiveSubaccounts(clientId) {
  return prisma.apiSubaccount.count({
    where: { clientId, isPrincipal: false, deactivatedAt: null },
  });
}

// Regla segura de desactivación: no se permite desactivar una subcuenta
// mientras tenga cualquier estado de cuenta con comisión pendiente de pago
// (vencida o no). `Statement.displayStatus` se deriva siempre de
// commission/commissionPaid (ver statementController.js) — nunca se guarda
// como columna redundante, así que se replica el mismo criterio aquí.
async function hasPendingStatements(apiSubaccountId) {
  const count = await prisma.statement.count({
    where: { apiSubaccountId, commission: { gt: 0 }, commissionPaid: false },
  });
  return count > 0;
}

module.exports = {
  ensurePrincipalSubaccount,
  getNextSlotIndex,
  countActiveSubaccounts,
  hasPendingStatements,
  MAX_SUBACCOUNTS_PER_CLIENT,
  PROCESS_CONDITION_TYPES,
};
