/*
 * CORRECCIÓN 19 — Infraestructura de 2FA (Google Authenticator / TOTP),
 * PREPARADA pero DESACTIVADA globalmente. Mientras TWO_FA_ENABLED no sea
 * literalmente "true" en el backend, ningún endpoint de esta utilidad es
 * alcanzable y el login funciona exactamente igual que hoy (solo correo +
 * contraseña). Esto permite activar 2FA en el futuro sin escribir código
 * nuevo — solo cambiando la variable de entorno y desplegando la UI.
 */
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { encrypt, decrypt } = require('./crypto');

function isTwoFactorGloballyEnabled() {
  return process.env.TWO_FA_ENABLED === 'true';
}

function generateSecret() {
  return authenticator.generateSecret();
}

async function buildQrCodeDataUrl(email, secret) {
  const otpauth = authenticator.keyuri(email, 'Quantum Liquidity Capital', secret);
  return QRCode.toDataURL(otpauth);
}

function verifyToken(secret, token) {
  if (!secret || !token) return false;
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

function encryptSecret(secret) {
  return encrypt(secret);
}

function decryptSecret(encrypted) {
  return decrypt(encrypted);
}

// Token temporal de un solo propósito emitido tras validar correo+contraseña
// cuando el usuario tiene 2FA activo — nunca es una sesión válida por sí
// mismo, solo autoriza la llamada a /auth/login/2fa dentro de 5 minutos.
function signTwoFactorChallenge(userId) {
  return jwt.sign({ sub: userId, purpose: '2fa_challenge' }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

function verifyTwoFactorChallenge(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.purpose !== '2fa_challenge') throw new Error('Token de verificación inválido');
  return payload.sub;
}

module.exports = {
  isTwoFactorGloballyEnabled,
  generateSecret,
  buildQrCodeDataUrl,
  verifyToken,
  encryptSecret,
  decryptSecret,
  signTwoFactorChallenge,
  verifyTwoFactorChallenge,
};
