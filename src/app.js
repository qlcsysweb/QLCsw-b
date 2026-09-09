const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const clientRoutes = require('./routes/clientRoutes');
const publicRoutes = require('./routes/publicRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// El navegador nunca incluye "/" al final del Origin (es solo scheme://host:port).
// Si CLIENT_ORIGIN se configura por error con una barra final (p. ej.
// "https://mi-app.vercel.app/"), la comparación exacta de `cors` nunca
// coincide y bloquea TODAS las peticiones reales — se normaliza aquí para
// que ese error de configuración no pueda volver a romper la conexión.
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '');

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'qlc-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/client', clientRoutes);
app.use('/api', publicRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
