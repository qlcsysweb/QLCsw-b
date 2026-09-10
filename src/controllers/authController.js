const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken, cookieOptions } = require('../utils/token');
const {
  isTwoFactorGloballyEnabled,
  verifyToken,
  decryptSecret,
  signTwoFactorChallenge,
  verifyTwoFactorChallenge,
} = require('../utils/twoFactor');

// CORRECCIÓN 17/18: no existe username global — el correo es el
// identificador de acceso, junto con la contraseña. Nada más.
const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1),
});

function shapeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    profile: user.role === 'ADMIN' ? user.adminProfile : user.clientProfile,
  };
}

const login = asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { adminProfile: true, clientProfile: true },
  });

  if (!user || !user.isActive) throw ApiError.unauthorized('Correo o contraseña incorrectos');

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) throw ApiError.unauthorized('Correo o contraseña incorrectos');

  // CORRECCIÓN 19: mientras TWO_FA_ENABLED no esté activo globalmente, este
  // bloque nunca se alcanza aunque el usuario tenga twoFactorEnabled=true
  // (no debería poder tenerlo, porque el endpoint de activación también
  // está bloqueado por la misma bandera) — el login sigue igual que hoy.
  if (isTwoFactorGloballyEnabled() && user.twoFactorEnabled) {
    const tempToken = signTwoFactorChallenge(user.id);
    return res.json({ ok: true, twoFactorRequired: true, tempToken });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signToken(user);
  res.cookie(process.env.COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true, user: shapeUser(user) });
});

const twoFactorLoginSchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().min(6).max(6),
});

const loginWithTwoFactor = asyncHandler(async (req, res) => {
  if (!isTwoFactorGloballyEnabled()) throw ApiError.forbidden('2FA no está disponible');
  const { tempToken, code } = twoFactorLoginSchema.parse(req.body);

  let userId;
  try {
    userId = verifyTwoFactorChallenge(tempToken);
  } catch {
    throw ApiError.unauthorized('Verificación expirada, inicia sesión de nuevo');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { adminProfile: true, clientProfile: true },
  });
  if (!user || !user.isActive || !user.twoFactorEnabled) throw ApiError.unauthorized('Sesión inválida');

  const secret = decryptSecret(user.twoFactorSecretEncrypted);
  if (!verifyToken(secret, code)) throw ApiError.unauthorized('Código incorrecto');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signToken(user);
  res.cookie(process.env.COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true, user: shapeUser(user) });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie(process.env.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

const me = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { adminProfile: true, clientProfile: true },
  });
  if (!user) throw ApiError.notFound('Usuario no encontrado');
  res.json({ ok: true, user: shapeUser(user) });
});

const changePassword = asyncHandler(async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres'),
  });
  const { currentPassword, newPassword } = schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!validPassword) throw ApiError.unauthorized('Contraseña actual incorrecta');

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  res.json({ ok: true, message: 'Contraseña actualizada correctamente.' });
});

// CORRECCIÓN 5: registro público directo — crea la cuenta CLIENT completa
// (User + ClientProfile + Process/condiciones vacías listas para su primera
// subcuenta) y deja al visitante con sesión iniciada. Ya NO pasa por
// "prospecto" — ese flujo queda reservado para quien solo pide información.
const registerSchema = z.object({
  firstName: z.string().min(1, 'El nombre es obligatorio'),
  lastName: z.string().min(1, 'El apellido es obligatorio'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

const register = asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw ApiError.conflict('Ya existe una cuenta con este correo.');

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          firstName: data.firstName,
          lastName: data.lastName,
        },
      },
    },
    include: { clientProfile: true },
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signToken(user);
  res.cookie(process.env.COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ ok: true, user: shapeUser(user) });
});

module.exports = { login, loginWithTwoFactor, logout, me, changePassword, register };
