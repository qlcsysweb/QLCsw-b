/*
 * 2FA con Google Authenticator (TOTP) — OBLIGATORIO para todos los usuarios:
 * cada cuenta lo registra en su primer inicio de sesión y no puede omitirlo
 * (ver middleware/auth.js). Después puede entrar con su contraseña O con el
 * código de Authenticator. Ya no depende de TWO_FA_ENABLED: solo existe un
 * interruptor de EMERGENCIA, TWO_FA_DISABLED=true, que lo apaga por completo.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { encrypt, decrypt } = require('./crypto');

// Tolerancia de ±1 intervalo (30 s) por desfase de reloj del teléfono o por
// escribir el código justo cuando cambia — práctica estándar en TOTP.
authenticator.options = { window: 1 };

function isTwoFactorGloballyEnabled() {
  return process.env.TWO_FA_DISABLED !== 'true';
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

function secretFingerprint(encryptedSecret) {
  if (!encryptedSecret) return null;
  return crypto.createHash('sha256').update(String(encryptedSecret)).digest('hex').slice(0, 16);
}

function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);
}

function signPasswordResetToken(user) {
  return jwt.sign(
    { sub: user.id, purpose: 'password_reset', pwf: passwordFingerprint(user.passwordHash) },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function verifyPasswordResetToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.purpose !== 'password_reset') throw new Error('Token de restablecimiento inválido');
  return payload;
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
  secretFingerprint,
  passwordFingerprint,
  signPasswordResetToken,
  verifyPasswordResetToken,
};
