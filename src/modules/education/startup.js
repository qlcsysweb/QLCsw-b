import { prisma } from './config/prisma.js';
import { startKeepAlive } from './services/keepAlive.service.js';
import { reconcileDiagnosisBreakdown, resyncPlaceholdersOnce } from './services/moduleData.service.js';
import { startIncomeJob } from './services/productIncome.service.js';
import { startSubscriptionJob } from './services/subscriber.service.js';
import { applyGoogleCredentials } from './services/mailSettings.service.js';
import { startExchangeRateJob } from './services/payments/paymentSettings.service.js';

export function startEducationTasks() {
  applyGoogleCredentials().catch((err) => console.error('[educacion] credenciales de Google', err.message));

  const keepAlive = startKeepAlive();
  const incomeJob = startIncomeJob();
  const subscriptionJob = startSubscriptionJob();
  const exchangeRateJob = startExchangeRateJob();

  reconcileDiagnosisBreakdown()
    .then((periods) => periods && console.info(`[educacion] desglose del diagnóstico conciliado en ${periods} periodos`))
    .then(() => resyncPlaceholdersOnce())
    .then((periods) => periods && console.info(`[educacion] inversiones por desglosar recalculadas en ${periods} periodos`))
    .catch((err) => console.error('[educacion] no se pudo conciliar el desglose del diagnóstico', err.message));

  return () => {
    if (keepAlive) clearInterval(keepAlive);
    clearInterval(incomeJob);
    clearInterval(subscriptionJob);
    clearInterval(exchangeRateJob);
  };
}

export const disconnectEducationDb = () => prisma.$disconnect();
