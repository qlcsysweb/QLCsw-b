const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const prisma = require('../config/prisma');
const { isTwoFactorGloballyEnabled } = require('../utils/twoFactor');

// 2FA OBLIGATORIO — una cuenta que todavía no
// configuró Google Authenticator solo puede usar estas rutas (ver su sesión,
// configurar el 2FA y cerrar sesión). Todo lo demás responde 403 hasta que
// lo active. El frontend la lleva directo a la pantalla de configuración.
const TWO_FACTOR_SETUP_PATHS = ['/api/auth/me', '/api/auth/logout', '/api/auth/2fa/'];
function isTwoFactorSetupPath(url) {
  const path = String(url || '').split('?')[0];
  return TWO_FACTOR_SETUP_PATHS.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

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
        const decoded = jwt.verify(candidate, process.env.JWT_SECRET);
        // Los tokens de un solo propósito (reto 2FA del login, restablecer
        // contraseña) se firman con el mismo secreto pero NUNCA son una
        // sesión: sin esto, el token temporal emitido tras la contraseña
        // serviría como sesión completa y se saltaría el código 2FA.
        if (decoded.purpose) continue;
        payload = decoded;
        break;
      } catch {
        // prueba el siguiente candidato
      }
    }
    if (!payload) throw ApiError.unauthorized('Sesión inválida o expirada');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw ApiError.unauthorized('Sesión inválida');

    req.user = { id: user.id, role: user.role, email: user.email, username: user.username };
    if (isTwoFactorGloballyEnabled() && !user.twoFactorEnabled && !isTwoFactorSetupPath(req.originalUrl)) {
      throw ApiError.forbidden('Debes activar la verificación en dos pasos (Google Authenticator) para continuar.');
    }
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
