/*
 * IDENTIFICADOR DE SUBCUENTA (ej. "PCB-1-A-1") — es un CONTROL INTERNO del
 * ADMIN: nunca se muestra al cliente (pantallas, notificaciones, correos ni
 * PDF). Al cliente se le nombra la subcuenta de forma neutra: "PRINCIPAL" o
 * "Subcuenta #N" (N = su número de orden, slotIndex).
 */
function clientSubaccountLabel(subaccount) {
  if (!subaccount) return '';
  if (subaccount.isPrincipal) return 'PRINCIPAL';
  return subaccount.slotIndex != null ? `Subcuenta #${subaccount.slotIndex}` : '';
}

// Campos necesarios para armar la etiqueta del cliente.
const CLIENT_LABEL_SELECT = { isPrincipal: true, slotIndex: true };

module.exports = { clientSubaccountLabel, CLIENT_LABEL_SELECT };
