const prisma = require('./config/prisma.cjs');
const { startStatementExpirySweep } = require('./utils/connectionDeadlines.cjs');
const { migrateAppointmentsToUtc } = require('./utils/appointmentsUtc.cjs');
const { backfillReferralLocks } = require('./utils/referralLock.cjs');
const { ensureSystemGuides } = require('./utils/systemGuides.cjs');
const { publishPublicSiteSnapshot } = require('./services/publicSiteSnapshot.cjs');

function startTradingTasks() {
  const sweep = startStatementExpirySweep();
  backfillReferralLocks()
    .then((n) => n && console.log(`[afiliación] candados creados: ${n}`))
    .catch((err) => console.error('[afiliación] no se pudieron crear candados:', err.message));
  if (process.env.TRAD_SKIP_SYSTEM_GUIDES_SYNC !== 'true') {
    ensureSystemGuides()
      .then((rows) => rows.forEach((g) => console.log(`[guías] creada "${g.titleEs}" en la posición ${g.displayOrder}`)))
      .catch((err) => console.error('[guías] no se pudieron crear las guías de sistema:', err.message));
  }
  if (process.env.TRAD_SKIP_PUBLIC_SITE_SNAPSHOT !== 'true') {
    publishPublicSiteSnapshot()
      .then((r) => r.published && console.log(`[sitio público] site-data.json publicado: ${r.url}`))
      .catch((err) => console.error('[sitio público] no se pudo publicar site-data.json:', err.message));
  }
  if (process.env.TRAD_SKIP_APPOINTMENTS_UTC_MIGRATION !== 'true') {
    migrateAppointmentsToUtc().catch((err) => console.error('[citas UTC] no se pudo convertir:', err.message));
  }
  return () => clearInterval(sweep);
}

const disconnectTradingDb = () => prisma.$disconnect();

module.exports = { startTradingTasks, disconnectTradingDb };
