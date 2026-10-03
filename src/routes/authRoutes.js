const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const {
  login,
  loginWithTwoFactor,
  loginWithCode,
  logout,
  me,
  changePassword,
  register,
  sendRegisterCode,
  verifyPasswordReset,
  completePasswordReset,
} = require('../controllers/authController');
const twoFactorController = require('../controllers/twoFactorController');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos de inicio de sesión. Intenta más tarde.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados registros desde este origen. Intenta más tarde.' },
});

// Restablecer contraseña con Google Authenticator: límite estricto para que
// el código de 6 dígitos no pueda adivinarse por fuerza bruta.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos de restablecimiento. Intenta más tarde.' },
});

router.post('/login', loginLimiter, login);
router.post('/password-reset/verify', passwordResetLimiter, verifyPasswordReset);
router.post('/password-reset/complete', passwordResetLimiter, completePasswordReset);
router.post('/login/2fa', loginLimiter, loginWithTwoFactor);
router.post('/login/code', loginLimiter, loginWithCode);
// Código de verificación del correo (límite propio para que no se use para
// enviar correos masivos).
const registerCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes de código. Intenta más tarde.' },
});
router.post('/register/email-code', registerCodeLimiter, sendRegisterCode);
router.post('/register', registerLimiter, register);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);

// 2FA (Google Authenticator) — obligatorio (ver utils/twoFactor.js).
router.get('/2fa/status', requireAuth, twoFactorController.getStatus);
router.post('/2fa/setup', requireAuth, twoFactorController.startSetup);
router.post('/2fa/confirm', requireAuth, twoFactorController.confirmSetup);
router.post('/2fa/disable', requireAuth, twoFactorController.disable);

module.exports = router;
