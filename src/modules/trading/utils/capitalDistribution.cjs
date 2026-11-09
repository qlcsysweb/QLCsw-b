// DISTRIBUCIÓN DE CAPITAL — "registro vigente" de la confirmación del
// cliente para el capital operativo requerido de una subcuenta.
//
// Una confirmación es UNA operación por requerimiento de capital: mientras
// la última confirmación siga en revisión (PENDING / EN_REVISION) o esté
// APROBADA para el MISMO monto que el admin tiene configurado hoy, no se
// crea otra (doble clic, reintento o reenvío devuelven la misma). Solo hay
// una operación nueva legítima cuando QLC rechazó la anterior o cuando el
// admin fijó un capital requerido distinto.
const ACTIVE_CAPITAL_STATUSES = ['PENDING', 'EN_REVISION'];
const FINAL_CAPITAL_STATUSES = ['APROBADO', 'RECHAZADO'];

const sameAmount = (a, b) => a != null && b != null && Number(a) === Number(b);

function isCurrentCapitalReport(report, requiredCapital) {
  if (!report) return false;
  if (ACTIVE_CAPITAL_STATUSES.includes(report.status)) return true;
  return report.status === 'APROBADO' && sameAmount(report.amount, requiredCapital);
}

// Última confirmación de la subcuenta (incluidas las que el cliente ocultó de
// su historial: siguen siendo el registro vigente).
function latestCapitalReport(db, apiSubaccountId) {
  return db.capitalDistributionReport.findFirst({
    where: { apiSubaccountId },
    orderBy: { reportedAt: 'desc' },
  });
}

// Serializa las confirmaciones concurrentes de UNA subcuenta dentro de la
// transacción (dos requests casi simultáneos nunca ven "no hay registro" a la
// vez). Se libera solo al terminar la transacción.
function lockCapitalSubaccount(tx, apiSubaccountId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`capital-distribution:${apiSubaccountId}`}))`;
}

module.exports = {
  ACTIVE_CAPITAL_STATUSES,
  FINAL_CAPITAL_STATUSES,
  isCurrentCapitalReport,
  latestCapitalReport,
  lockCapitalSubaccount,
};
