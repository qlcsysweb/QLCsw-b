const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken, cookieOptions } = require('../utils/token');

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const login = asyncHandler(async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { username },
    include: { adminProfile: true, clientProfile: true },
  });

  if (!user || !user.isActive) throw ApiError.unauthorized('Usuario o contraseña incorrectos');

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) throw ApiError.unauthorized('Usuario o contraseña incorrectos');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signToken(user);
  res.cookie(process.env.COOKIE_NAME, token, cookieOptions());

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      profile: user.role === 'ADMIN' ? user.adminProfile : user.clientProfile,
    },
  });
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

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      profile: user.role === 'ADMIN' ? user.adminProfile : user.clientProfile,
    },
  });
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

module.exports = { login, logout, me, changePassword };
