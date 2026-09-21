/*
 * Lista blanca de orígenes permitidos por CORS — QLC vive en dos dominios de
 * frontend (el dominio propio qlctrade.net y la URL de despliegue de Vercel)
 * más las URLs de preview de Vercel por rama, así que un único
 * `Access-Control-Allow-Origin` fijo (como había antes, tomado literalmente
 * de CLIENT_ORIGIN) SIEMPRE rompe a los demás: el paquete `cors` devuelve
 * ese string fijo sin importar qué origen hizo la petición.
 *
 * Aquí en cambio se valida el Origin real de cada petición contra esta
 * lista, y solo si coincide se refleja ESE MISMO origen en la respuesta
 * (nunca un comodín "*", y nunca un origen fijo que no sea el que preguntó).
 *
 * OJO: esto es independiente de `CLIENT_ORIGIN` (ver app.js / driveConfigController.js
 * / emailConfigController.js), que sigue siendo la URL única a la que el
 * backend redirige al navegador tras completar el OAuth2 de Google — no se
 * toca ni se reutiliza para esto.
 */
function normalizeOrigin(value) {
  return (value || '').trim().replace(/\/+$/, '');
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.qlctrade.net',
  'https://qlctrade.net',
  'https://ql-csw-f-git-main-qlc1.vercel.app',
  'https://ql-csw-f.vercel.app',
];

// ALLOWED_ORIGINS (Render): lista separada por comas para agregar/quitar
// orígenes sin tocar código (p. ej. una nueva URL de preview de Vercel).
// Los 4 orígenes de arriba quedan permitidos siempre, aunque la variable no
// esté configurada, para que el valor por defecto nunca deje el sistema roto.
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

// Fuera de producción (dev local, `npm run dev`), el frontend corre en
// localhost — se permite sin depender de ALLOWED_ORIGINS para que nadie
// tenga que configurar nada extra solo para levantar el proyecto en su
// máquina. Nunca se agrega en producción (Render corre con NODE_ENV=production).
const LOCAL_DEV_ORIGINS =
  process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const ALLOWED_ORIGINS = Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins, ...LOCAL_DEV_ORIGINS]));

function isOriginAllowed(origin) {
  return ALLOWED_ORIGINS.includes(normalizeOrigin(origin));
}

const corsOptions = {
  origin(origin, callback) {
    // Sin header Origin (curl, health checks, llamadas servidor-a-servidor):
    // no hay política de navegador que aplicar, se permite.
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) return callback(null, true);
    const err = new Error(`Origen no permitido por CORS: ${origin}`);
    err.statusCode = 403;
    return callback(err);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = { corsOptions, ALLOWED_ORIGINS, isOriginAllowed, normalizeOrigin };
