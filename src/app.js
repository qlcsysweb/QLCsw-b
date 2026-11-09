import './shared/loadEnv.js';
import express from 'express';
import { createEducationRouter, EDUCATION_API_PATH } from './modules/education/router.js';
import { createTradingRouter } from './modules/trading/router.cjs';
import { TRADING_API_PATH } from './modules/trading/config/mount.cjs';

const trustProxyHops = () => Number(process.env.EDU_TRUST_PROXY_HOPS || process.env.TRAD_TRUST_PROXY_HOPS) || 1;

export function createApp() {
  const app = express();
  app.set('trust proxy', trustProxyHops());
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'qlc-backend' }));

  app.use(TRADING_API_PATH, createTradingRouter());
  app.use(EDUCATION_API_PATH, createEducationRouter());

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Ruta no encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[servidor] error no controlado:', err?.message || err);
    res.status(err?.status || err?.statusCode || 500).json({ ok: false, error: 'Error interno del servidor' });
  });
  return app;
}

export default createApp();
