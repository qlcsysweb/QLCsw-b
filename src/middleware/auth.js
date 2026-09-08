const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const prisma = require('../config/prisma');

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[process.env.COOKIE_NAME] || extractBearer(req);
    if (!token) throw ApiError.unauthorized('Sesión no encontrada');

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw ApiError.unauthorized('Sesión inválida');

    req.user = { id: user.id, role: user.role, email: user.email, username: user.username };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(ApiError.unauthorized('Sesión inválida o expirada'));
  }
}

function extractBearer(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden('No tienes permisos para esta acción'));
    next();
  };
}

module.exports = { requireAuth, requireRole };
