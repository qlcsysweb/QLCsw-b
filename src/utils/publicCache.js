/*
 * CACHÉ DEL SITIO PÚBLICO — las rutas públicas (modelos, multimedia, logo,
 * FAQ, track record, UID de pago) responden desde memoria y solo consultan
 * NeonDB la primera vez, cuando vence la caché o cuando un ADMIN guarda un
 * cambio (adminRoutes vacía la caché después de cualquier escritura exitosa).
 * Así cada visita al sitio deja de despertar la base de datos.
 *
 * Además se envía Cache-Control para que el navegador del visitante no
 * repita la misma petición durante unos minutos.
 */
const TTL_MS = Number(process.env.PUBLIC_CACHE_TTL_MS) || 6 * 60 * 60 * 1000; // 6 h
const BROWSER_MAX_AGE_S = 300; // 5 min

const store = new Map();

// `ttlMs` por ruta: p. ej. el reparto de afiliados tiene cambios programados
// por fecha de vigencia, así que se refresca más seguido.
const cachedPublicFor = (ttlMs) => (req, res, next) => cachedPublicWithTtl(req, res, next, ttlMs);
const cachedPublic = (req, res, next) => cachedPublicWithTtl(req, res, next, TTL_MS);

function cachedPublicWithTtl(req, res, next, ttlMs) {
  if (req.method !== 'GET') return next();
  const key = req.originalUrl;
  const hit = store.get(key);
  res.set('Cache-Control', `public, max-age=${BROWSER_MAX_AGE_S}`);
  if (hit && hit.expiresAt > Date.now()) {
    res.set('X-Public-Cache', 'HIT');
    return res.json(hit.body);
  }
  const json = res.json.bind(res);
  res.json = (body) => {
    // Solo se guardan respuestas correctas; un error nunca queda en caché.
    if (res.statusCode === 200 && body && body.ok !== false) {
      store.set(key, { body, expiresAt: Date.now() + ttlMs });
    }
    res.set('X-Public-Cache', 'MISS');
    return json(body);
  };
  return next();
}

function clearPublicCache() {
  store.clear();
}

// Para adminRoutes: tras cualquier escritura exitosa de un admin (CMS,
// multimedia, modelos, FAQ, track record, datos de pago…) se vacía la caché,
// de modo que el sitio público refleja el cambio en la siguiente visita.
function clearPublicCacheAfterAdminWrite(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400) clearPublicCache();
    });
  }
  next();
}

module.exports = { cachedPublic, cachedPublicFor, clearPublicCache, clearPublicCacheAfterAdminWrite };
