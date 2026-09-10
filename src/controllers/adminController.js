const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const MAX_ADMINS = 3;

const listAdmins = asyncHandler(async (req, res) => {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    include: { adminProfile: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json({
    ok: true,
    admins: admins.map((a) => ({
      id: a.id,
      email: a.email,
      isActive: a.isActive,
      lastLoginAt: a.lastLoginAt,
      profile: a.adminProfile,
    })),
    limit: MAX_ADMINS,
  });
});

const createAdminSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  permissions: z.record(z.boolean()).optional(),
});

const createAdmin = asyncHandler(async (req, res) => {
  const currentCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (currentCount >= MAX_ADMINS) {
    throw ApiError.forbidden(`El plan contempla un máximo de ${MAX_ADMINS} administradores.`);
  }

  const data = createAdminSchema.parse(req.body);
  const existingEmail = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingEmail) throw ApiError.conflict('Ya existe un usuario con ese email');

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      role: 'ADMIN',
      adminProfile: {
        create: {
          firstName: data.firstName,
          lastName: data.lastName,
          permissions: data.permissions || {},
        },
      },
    },
    include: { adminProfile: true },
  });

  res.status(201).json({ ok: true, admin: { id: user.id, email: user.email, profile: user.adminProfile } });
});

const updateAdminSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  permissions: z.record(z.boolean()).optional(),
});

const updateAdmin = asyncHandler(async (req, res) => {
  const data = updateAdminSchema.parse(req.body);
  const admin = await prisma.user.findUnique({ where: { id: req.params.id }, include: { adminProfile: true } });
  if (!admin || admin.role !== 'ADMIN') throw ApiError.notFound('Administrador no encontrado');

  if (admin.id === req.user.id && data.isActive === false) {
    throw ApiError.badRequest('No puedes desactivar tu propia cuenta.');
  }

  if (typeof data.isActive === 'boolean') {
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: data.isActive } });
  }
  if (data.firstName || data.lastName || data.permissions) {
    await prisma.adminProfile.update({
      where: { userId: admin.id },
      data: {
        ...(data.firstName ? { firstName: data.firstName } : {}),
        ...(data.lastName ? { lastName: data.lastName } : {}),
        ...(data.permissions ? { permissions: data.permissions } : {}),
      },
    });
  }

  const updated = await prisma.user.findUnique({ where: { id: admin.id }, include: { adminProfile: true } });
  res.json({ ok: true, admin: { id: updated.id, email: updated.email, isActive: updated.isActive, profile: updated.adminProfile } });
});

module.exports = { listAdmins, createAdmin, updateAdmin, MAX_ADMINS };
