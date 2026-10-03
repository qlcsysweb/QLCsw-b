/*
 * ¿CUENTA ACTIVADA? — regla ÚNICA usada en todo el sistema (estado del
 * cliente, "Afiliados activos" del promotor, estado del referido):
 * una subcuenta vigente cuenta como ACTIVADA cuando QLC la activó (botón
 * "Activar") o cuando su paso de "Activación" del proceso está COMPLETADO.
 * Antes solo contaba el botón, y una cuenta con su "Activación" ya completada
 * aparecía como "en proceso" y no sumaba en "Afiliados activos".
 */
function isAccountActivated(s) {
  if (!s || s.deactivatedAt) return false;
  if (s.process?.isActivated) return true;
  return (s.process?.conditions || []).some((c) => c.type === 'ACTIVATION' && c.status === 'CONFIRMED');
}

// Select mínimo para poder aplicar la regla.
const ACTIVATION_SELECT = {
  deactivatedAt: true,
  process: { select: { isActivated: true, conditions: { where: { type: 'ACTIVATION' }, select: { type: true, status: true } } } },
};

module.exports = { isAccountActivated, ACTIVATION_SELECT };
