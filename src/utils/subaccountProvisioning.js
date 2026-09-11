/*
 * Especificación funcional QLC — Flujo de Registro, Subcuentas y
 * Distribución de Saldo: al registrarse, cada cliente recibe automáticamente
 * 1 cuenta principal + 20 subcuentas individuales. Los datos generales del
 * cliente (nombre, nacionalidad, contrato) se heredan conceptualmente hacia
 * las 20 subcuentas — nunca se vuelven a pedir. Lo único independiente por
 * subcuenta es su propia API Key/Secret/Passphrase.
 *
 * Esta función es idempotente: si el cliente ya tiene subcuentas (parcial o
 * completo), solo crea las que falten hasta llegar a 20 — nunca duplica.
 */
const prisma = require('../config/prisma');

// CORRECCIÓN 6 — orden alineado al flujo real del cliente: Wallet/API →
// Contrato → Garantía (PAYMENT, mínimo 10% del capital) → Capital
// distribuido en el exchange (FUNDS) → Activación. Los VALORES del enum no
// cambian (compatibilidad con filas existentes) — solo el orden en el que
// se crean/muestran las condiciones de cada subcuenta nueva.
const PROCESS_CONDITION_TYPES = ['WALLET', 'CONTRACT', 'PAYMENT', 'FUNDS', 'API', 'ACTIVATION'];
const MAX_SUBACCOUNTS_PER_CLIENT = 20;

async function ensureAllSubaccounts(clientId) {
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId } });
  if (!client) return [];

  const existing = await prisma.apiSubaccount.findMany({
    where: { clientId },
    select: { slotIndex: true },
    orderBy: { slotIndex: 'asc' },
  });
  const existingSlots = new Set(existing.map((s) => s.slotIndex));
  const clientHasWallet = Boolean(client.walletAddress);

  const created = [];
  for (let slot = 1; slot <= MAX_SUBACCOUNTS_PER_CLIENT; slot += 1) {
    if (existingSlots.has(slot)) continue;
    // eslint-disable-next-line no-await-in-loop
    const subaccount = await prisma.apiSubaccount.create({
      data: {
        clientId,
        slotIndex: slot,
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
    });
    created.push(subaccount);
  }
  return created;
}

module.exports = { ensureAllSubaccounts, MAX_SUBACCOUNTS_PER_CLIENT, PROCESS_CONDITION_TYPES };
