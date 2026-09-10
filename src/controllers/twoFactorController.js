const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
  isTwoFactorGloballyEnabled,
  generateSecret,
  buildQrCodeDataUrl,
  verifyToken,
  encryptSecret,
  decryptSecret,
} = require('../utils/twoFactor');

/*
 * CORRECCIÓN 19 — Toda esta infraestructura queda PREPARADA pero cada
 * endpoint rechaza la petición (403) mientras TWO_FA_ENABLED no sea
 * "true" en el backend. Así el código real de activación/verificación
 * existe y puede probarse, pero no cambia el comportamiento de login de
 * nadie hasta que se decida activarlo explícitamente.
 */
function assertTwoFactorFeatureOn() {
  if (!isTwoFactorGloballyEnabled()) {
    throw ApiError.forbidden('La verificación en dos pasos todavía no está disponible.');
  }
}

const getStatus = asyncHandler(async (req, res) => {
  assertTwoFactorFeatureOn();
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ ok: true, enabled: user.twoFactorEnabled });
});

// Paso 1: genera un secreto pendiente + QR. No activa 2FA todavía — hace
// falta confirmar con un código válido (ver /confirm).
const startSetup = asyncHandler(async (req, res) => {
  assertTwoFactorFeatureOn();
  const secret = generateSecret();
  const qrCodeDataUrl = await buildQrCodeDataUrl(req.user.email, secret);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { twoFactorPendingSecretEncrypted: encryptSecret(secret) },
  });

  res.json({ ok: true, qrCodeDataUrl, secret });
});

const confirmSchema = z.object({ code: z.string().min(6).max(6) });

const confirmSetup = asyncHandler(async (req, res) => {
  assertTwoFactorFeatureOn();
  const { code } = confirmSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.twoFactorPendingSecretEncrypted) {
    throw ApiError.badRequest('No hay una configuración de 2FA pendiente. Inicia el proceso de nuevo.');
  }

  const pendingSecret = decryptSecret(user.twoFactorPendingSecretEncrypted);
  if (!verifyToken(pendingSecret, code)) throw ApiError.unauthorized('Código incorrecto');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorSecretEncrypted: user.twoFactorPendingSecretEncrypted,
      twoFactorPendingSecretEncrypted: null,
    },
  });

  res.json({ ok: true, enabled: true });
});

const disableSchema = z.object({ password: z.string().min(1) });

const disable = asyncHandler(async (req, res) => {
  assertTwoFactorFeatureOn();
  const bcrypt = require('bcryptjs');
  const { password } = disableSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) throw ApiError.unauthorized('Contraseña incorrecta');

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecretEncrypted: null, twoFactorPendingSecretEncrypted: null },
  });

  res.json({ ok: true, enabled: false });
});

module.exports = { getStatus, startSetup, confirmSetup, disable };
