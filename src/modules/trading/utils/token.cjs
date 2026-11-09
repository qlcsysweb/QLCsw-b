const jwt = require('jsonwebtoken');
const { TRADING_BASE_PATH } = require('../config/mount.cjs');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.TRAD_JWT_SECRET, {
    expiresIn: process.env.TRAD_JWT_EXPIRES_IN || '8h',
  });
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: process.env.TRAD_COOKIE_SAMESITE || (isProd ? 'none' : 'lax'),
    maxAge: 8 * 60 * 60 * 1000,
    path: process.env.TRAD_COOKIE_PATH || TRADING_BASE_PATH,
  };
}

// Para borrar la cookie el navegador exige los MISMOS atributos con los que
// se creó (Secure/SameSite/Path); sin ellos en producción la cookie no se
// elimina y la sesión "revive" tras cerrar sesión.
function clearCookieOptions() {
  const { maxAge, ...rest } = cookieOptions();
  return rest;
}

module.exports = { signToken, cookieOptions, clearCookieOptions };
