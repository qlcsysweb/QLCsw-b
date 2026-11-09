const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes.cjs');
const adminRoutes = require('./routes/adminRoutes.cjs');
const clientRoutes = require('./routes/clientRoutes.cjs');
const publicRoutes = require('./routes/publicRoutes.cjs');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler.cjs');
const { corsOptions } = require('./config/corsConfig.cjs');

function createTradingRouter() {
  const router = express.Router();

  router.use(cors(corsOptions));
  router.options('*', cors(corsOptions));
  router.use(express.json({ limit: '2mb' }));
  router.use(cookieParser());
  // Datos siempre frescos: ninguna respuesta de la API se guarda en caché.
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  router.get('/health', (req, res) => res.json({ ok: true, service: 'qlc-trading' }));

  router.use('/auth', authRoutes);
  router.use('/admin', adminRoutes);
  router.use('/client', clientRoutes);
  router.use('/', publicRoutes);

  router.use(notFoundHandler);
  router.use(errorHandler);
  return router;
}

module.exports = { createTradingRouter };
