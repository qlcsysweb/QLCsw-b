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
 * Registro del 2FA (Google Authenticator). Solo responde 403 si el
 * interruptor de emergencia TWO_FA_DISABLED=true lo apagó por completo.
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
  // Con el 2FA ya activo no se puede reemplazar el Authenticator desde la
  // sesión (una sesión robada no debe poder cambiarlo). Si el cliente perdió
  // su teléfono, un ADMIN restablece su 2FA y lo vuelve a configurar.
  const current = await prisma.user.findUnique({ where: { id: req.user.id }, select: { twoFactorEnabled: true } });
  if (current.twoFactorEnabled) throw ApiError.conflict('La verificación en dos pasos ya está activa.');
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
  // 400 (no 401): el usuario SÍ tiene sesión; un 401 haría que el frontend
  // la cerrara como si hubiera expirado.
  if (!verifyToken(pendingSecret, code)) throw ApiError.badRequest('Código incorrecto');

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
  // El 2FA es OBLIGATORIO: nadie puede desactivarlo
  // por su cuenta (solo un ADMIN lo restablece para reconfigurarlo).
  if (isTwoFactorGloballyEnabled()) {
    throw ApiError.forbidden('La verificación en dos pasos es obligatoria y no se puede desactivar.');
  }
  const bcrypt = require('bcryptjs');
  const { password } = disableSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) throw ApiError.badRequest('Contraseña incorrecta');

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecretEncrypted: null, twoFactorPendingSecretEncrypted: null },
  });

  res.json({ ok: true, enabled: false });
});

// ADMIN — restablece el 2FA de un cliente (p. ej. perdió su teléfono). La
// próxima vez que inicie sesión deberá configurar Google Authenticator de
// nuevo. Nunca expone ni devuelve el secreto.
const adminResetClientTwoFactor = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId }, select: { userId: true } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  await prisma.user.update({
    where: { id: client.userId },
    data: { twoFactorEnabled: false, twoFactorSecretEncrypted: null, twoFactorPendingSecretEncrypted: null },
  });
  res.json({ ok: true });
});

module.exports = { getStatus, startSetup, confirmSetup, disable, adminResetClientTwoFactor };
