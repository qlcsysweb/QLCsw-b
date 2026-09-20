const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const clientRoutes = require('./routes/clientRoutes');
const publicRoutes = require('./routes/publicRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { corsOptions } = require('./config/corsConfig');

const app = express();

// CORS dinámico contra una lista blanca (ver config/corsConfig.js) — el
// frontend vive en más de un origen (dominio propio qlctrade.net + URL de
// Vercel + previews por rama), así que un `Access-Control-Allow-Origin` fijo
// (lo que había antes) siempre termina rompiendo a alguno de ellos.
app.use(cors(corsOptions));
// Preflight explícito para cualquier ruta — algunas peticiones (headers no
// simples, métodos como PATCH/DELETE) disparan OPTIONS antes de la petición
// real, y necesitan la misma política que arriba.
app.options('*', cors(corsOptions));
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
