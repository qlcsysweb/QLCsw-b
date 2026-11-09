import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import { authenticate, privateAccess, requireRole, subjectAccess } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import authRoutes from './routes/auth.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import giftRoutes from './routes/gift.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import adminRoutes from './routes/admin.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import periodRoutes from './routes/period.routes.js';
import portfolioRoutes from './routes/portfolio.routes.js';
import debtRoutes from './routes/debt.routes.js';
import closeRoutes from './routes/close.routes.js';
import annualRoutes from './routes/annual.routes.js';
import academyRoutes from './routes/academy.routes.js';
import patrimonialRoutes from './routes/patrimonial.routes.js';
import appointmentRoutes from './routes/appointment.routes.js';
import { googleRouter, mediaRouter, publicRouter } from './routes/public.routes.js';
import { businessRouter } from './routes/business.routes.js';
import { expensesRouter, incomesRouter, movementsRouter, protectionRouter } from './routes/finance.routes.js';

export const EDUCATION_API_PATH = '/api';

export function createEducationRouter() {
  const router = express.Router();
  router.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  router.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.frontendUrls.includes(origin)),
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id'],
      exposedHeaders: ['Content-Disposition'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );
  router.use(express.json({
    limit: '200kb',
    verify: (req, _res, buf) => {
      if (req.originalUrl.startsWith(`${EDUCATION_API_PATH}/webhooks/`)) req.rawBody = buf.toString('utf8');
    },
  }));

  router.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  router.use('/webhooks', webhookRoutes);
  router.use('/google', googleRouter);
  router.use('/media', mediaRouter);
  router.use('/auth', authRoutes);
  router.use(apiLimiter);
  router.use('/public', publicRouter);
  router.use('/payments', authenticate, paymentRoutes);
  router.use('/gifts', authenticate, giftRoutes);
  router.use('/admin', authenticate, requireRole('ADMIN'), adminRoutes);
  router.use('/academy', ...subjectAccess, academyRoutes);
  router.use('/academy', ...subjectAccess, patrimonialRoutes);

  const priv = (path, routes) => router.use(path, ...privateAccess, routes);
  priv('/dashboard', dashboardRoutes);
  priv('/periods', periodRoutes);
  priv('/portfolio', portfolioRoutes);
  priv('/incomes', incomesRouter);
  priv('/expenses', expensesRouter);
  priv('/protection', protectionRouter);
  priv('/debts', debtRoutes);
  priv('/patrimonial-movements', movementsRouter);
  priv('/business', businessRouter);
  priv('/monthly-closes', closeRoutes);
  priv('/annual-reports', annualRoutes);
  router.use('/appointments', ...subjectAccess, appointmentRoutes);

  router.use(notFoundHandler);
  router.use(errorHandler);
  return router;
}
