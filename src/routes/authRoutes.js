const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { login, loginWithTwoFactor, logout, me, changePassword, register } = require('../controllers/authController');
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

router.post('/login', loginLimiter, login);
router.post('/login/2fa', loginLimiter, loginWithTwoFactor);
router.post('/register', registerLimiter, register);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);

// CORRECCIÓN 19 — preparado pero inactivo mientras TWO_FA_ENABLED != "true"
router.get('/2fa/status', requireAuth, twoFactorController.getStatus);
router.post('/2fa/setup', requireAuth, twoFactorController.startSetup);
router.post('/2fa/confirm', requireAuth, twoFactorController.confirmSetup);
router.post('/2fa/disable', requireAuth, twoFactorController.disable);

module.exports = router;
