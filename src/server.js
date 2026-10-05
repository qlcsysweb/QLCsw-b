require('dotenv').config();
const app = require('./app');
const { startStatementExpirySweep } = require('./utils/connectionDeadlines');
const { migrateAppointmentsToUtc } = require('./utils/appointmentsUtc');
const { startKeepAlive } = require('./utils/keepAlive');
const { backfillReferralLocks } = require('./utils/referralLock');

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
  // Citas antiguas (hora de México) → UTC, una sola vez. SKIP_APPOINTMENTS_UTC_MIGRATION
  // =true la omite (pruebas locales contra la base de producción antes de desplegar).
  if (process.env.SKIP_APPOINTMENTS_UTC_MIGRATION !== 'true') {
    migrateAppointmentsToUtc().catch((err) => console.error('[citas UTC] no se pudo convertir:', err.message));
  }
});
