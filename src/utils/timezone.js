/*
 * CORRECCIÓN 15/21 — todos los horarios del sistema (citas, estados de
 * cuenta, historial de conexión, notificaciones con plazos) se muestran en
 * America/Mexico_City (CDMX), nunca en la zona horaria del navegador. Los
 * timestamps se siguen guardando en UTC en NeonDB (estándar de Postgres);
 * esta utilidad solo controla cómo se FORMATEAN para mostrarse.
 */
const TIME_ZONE = 'America/Mexico_City';

function formatCdmx(date, options = {}) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options,
  }).format(d) + ' CDMX';
}

module.exports = { TIME_ZONE, formatCdmx };
