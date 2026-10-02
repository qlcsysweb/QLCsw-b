/*
 * MANTENER DESPIERTO EL BACKEND (Render gratuito) — Render duerme el servicio
 * tras ~15 minutos sin peticiones y la siguiente visita tarda en despertarlo.
 * El propio backend se consulta a sí mismo por su URL PÚBLICA cada 10 minutos
 * (la petición entra por Render como tráfico real, así nunca queda inactivo).
 *
 * - En Render, RENDER_EXTERNAL_URL la define Render automáticamente.
 * - KEEP_ALIVE_URL permite fijar otra URL pública.
 * - KEEP_ALIVE=false lo desactiva. En local (sin URL pública) no hace nada.
 *
 * Respaldo externo: .github/workflows/keep-alive.yml despierta el servicio si
 * alguna vez llegara a dormirse (por ejemplo, tras un reinicio de Render).
 */
const INTERVAL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 30 * 1000;

function startKeepAlive() {
  if (process.env.KEEP_ALIVE === 'false') return null;
  const base = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  const url = `${base}/api/health`;

  let failures = 0;
  const ping = async () => {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (failures) console.log('[keep-alive] recuperado');
      failures = 0;
    } catch (err) {
      failures += 1;
      // Solo se registra el primer fallo de una racha (sin llenar el log).
      if (failures === 1) console.warn('[keep-alive] no se pudo consultar', url, '-', err.message);
    }
  };

  console.log(`[keep-alive] activo: ${url} cada ${INTERVAL_MS / 60000} min`);
  return setInterval(ping, INTERVAL_MS);
}

module.exports = { startKeepAlive };
