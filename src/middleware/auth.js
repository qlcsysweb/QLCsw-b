const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const prisma = require('../config/prisma');

async function requireAuth(req, res, next) {
  try {
    // El header Authorization (enviado siempre por el frontend cuando hay
    // sesión) tiene prioridad sobre la cookie: una cookie vieja/ajena de otro
    // rol o vencida jamás debe tapar un token Bearer válido (síntoma: login
    // "exitoso" y luego 401 en todo).
    const candidates = [extractBearer(req), req.cookies?.[process.env.COOKIE_NAME]].filter(Boolean);
    if (candidates.length === 0) throw ApiError.unauthorized('Sesión no encontrada');

    let payload = null;
    for (const candidate of candidates) {
      try {
        payload = jwt.verify(candidate, process.env.JWT_SECRET);
        break;
      } catch {
        // prueba el siguiente candidato
      }
    }
    if (!payload) throw ApiError.unauthorized('Sesión inválida o expirada');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw ApiError.unauthorized('Sesión inválida');

    req.user = { id: user.id, role: user.role, email: user.email, username: user.username };
    next();
  } catch (err) {
    // Solo los problemas de credencial son 401. Un error de base de datos u
    // otro fallo interno NO debe disfrazarse de "sesión inválida": eso hacía
    // que el frontend cerrara la sesión en bucle y ocultaba la causa real.
    return next(err);
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
