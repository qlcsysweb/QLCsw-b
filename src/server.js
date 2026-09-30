require('dotenv').config();
const app = require('./app');
const { startStatementExpirySweep } = require('./utils/connectionDeadlines');
const { migrateAppointmentsToUtc } = require('./utils/appointmentsUtc');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`QLC backend escuchando en http://localhost:${PORT}`);
  // Vencimiento de estados de cuenta (72 h) aunque nadie tenga la página abierta.
  startStatementExpirySweep();
  // Citas antiguas (hora de México) → UTC, una sola vez. SKIP_APPOINTMENTS_UTC_MIGRATION
  // =true la omite (pruebas locales contra la base de producción antes de desplegar).
  if (process.env.SKIP_APPOINTMENTS_UTC_MIGRATION !== 'true') {
    migrateAppointmentsToUtc().catch((err) => console.error('[citas UTC] no se pudo convertir:', err.message));
  }
});
