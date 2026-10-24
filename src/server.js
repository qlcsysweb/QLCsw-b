require('dotenv').config();
const app = require('./app');
const { startStatementExpirySweep } = require('./utils/connectionDeadlines');
const { migrateAppointmentsToUtc } = require('./utils/appointmentsUtc');
const { startKeepAlive } = require('./utils/keepAlive');
const { backfillReferralLocks } = require('./utils/referralLock');
const { ensureSystemGuides } = require('./utils/systemGuides');
const { publishPublicSiteSnapshot } = require('./services/publicSiteSnapshot');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`QLC backend escuchando en http://localhost:${PORT}`);
  // Vencimiento de estados de cuenta (72 h) aunque nadie tenga la página abierta.
  startStatementExpirySweep();
  // Render gratuito: evita que el servicio se duerma por inactividad.
  startKeepAlive();
  // Candado de afiliación para clientes con afiliador que aún no lo tienen.
  backfillReferralLocks()
    .then((n) => n && console.log(`[afiliación] candados creados: ${n}`))
    .catch((err) => console.error('[afiliación] no se pudieron crear candados:', err.message));
  // Guías de sistema (p. ej. "Guía de Uso — Permisos de API"): se crean una
  // sola vez si faltan, sin tocar las demás. SKIP_SYSTEM_GUIDES_SYNC=true la
  // omite (pruebas locales contra la base de producción antes de desplegar).
  if (process.env.SKIP_SYSTEM_GUIDES_SYNC !== 'true') {
    ensureSystemGuides()
      .then((rows) => rows.forEach((g) => console.log(`[guías] creada "${g.titleEs}" en la posición ${g.displayOrder}`)))
      .catch((err) => console.error('[guías] no se pudieron crear las guías de sistema:', err.message));
  }
  // Datos del sitio público en Cloudinary (site-data.json): el sitio no consulta
  // este backend. SKIP_PUBLIC_SITE_SNAPSHOT=true lo omite (pruebas locales).
  if (process.env.SKIP_PUBLIC_SITE_SNAPSHOT !== 'true') {
    publishPublicSiteSnapshot()
      .then((r) => r.published && console.log(`[sitio público] site-data.json publicado: ${r.url}`))
      .catch((err) => console.error('[sitio público] no se pudo publicar site-data.json:', err.message));
  }
  // Citas antiguas (hora de México) → UTC, una sola vez. SKIP_APPOINTMENTS_UTC_MIGRATION
  // =true la omite (pruebas locales contra la base de producción antes de desplegar).
  if (process.env.SKIP_APPOINTMENTS_UTC_MIGRATION !== 'true') {
    migrateAppointmentsToUtc().catch((err) => console.error('[citas UTC] no se pudo convertir:', err.message));
  }
});
