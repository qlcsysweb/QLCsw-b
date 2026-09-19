const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyAdmins } = require('../utils/notify');

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

  await notifyAdmins({
    title: 'Nuevo administrador registrado',
    message: `${data.firstName} ${data.lastName} (${data.email}) fue dado de alta como administrador.`,
    type: 'info',
    templateKey: 'new_admin_registered_admin',
    templateParams: { adminName: `${data.firstName} ${data.lastName}`, email: data.email },
    excludeUserId: user.id,
  });

  res.status(201).json({ ok: true, admin: { id: user.id, email: user.email, profile: user.adminProfile } });
});

// CORRECCIÓN 3 (bloque de 20) — un admin autorizado puede editar el
// correo/contraseña de otro admin desde el mismo modal. La contraseña es
// opcional: si se omite, se conserva la actual (nunca se exige cambiarla).
const updateAdminSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email('Email inválido').optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
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

  if (data.isActive === false && admin.adminProfile?.isGeneralAdmin) {
    throw ApiError.badRequest(
      'No puedes desactivar a un administrador general. Quítale primero el rango de administrador general.'
    );
  }

  if (data.email && data.email !== admin.email) {
    const clash = await prisma.user.findUnique({ where: { email: data.email } });
    if (clash) throw ApiError.conflict('Ya existe un usuario con ese email');
  }

  if (typeof data.isActive === 'boolean' || data.email || data.password) {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        ...(typeof data.isActive === 'boolean' ? { isActive: data.isActive } : {}),
        ...(data.email ? { email: data.email } : {}),
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 12) } : {}),
      },
    });
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

// CORREGIR(2).xlsx ADMIN 36 — designar/quitar al "administrador general"
// (único que puede eliminar clientes con la contraseña de seguridad, ver
// securityConfigController.js). Regla: si ya existe al menos un admin
// general, solo otro admin general puede otorgar/quitar el rol, y nunca se
// puede dejar el sistema sin ninguno. Si todavía no existe ninguno (arranque
// del sistema), se permite auto-nombrarse una sola vez — nunca nombrar a
// otro admin sin ya tener el rol.
const setGeneralAdminSchema = z.object({ isGeneralAdmin: z.boolean() });

const setGeneralAdmin = asyncHandler(async (req, res) => {
  const { isGeneralAdmin } = setGeneralAdminSchema.parse(req.body);
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { adminProfile: true } });
  if (!target || target.role !== 'ADMIN' || !target.adminProfile) throw ApiError.notFound('Administrador no encontrado');

  const actingAdmin = await prisma.adminProfile.findUnique({ where: { userId: req.user.id } });
  const generalCount = await prisma.adminProfile.count({ where: { isGeneralAdmin: true } });

  if (generalCount > 0) {
    if (!actingAdmin?.isGeneralAdmin) {
      throw ApiError.forbidden('Solo un administrador general puede otorgar o quitar este rol.');
    }
    if (!isGeneralAdmin && target.adminProfile.isGeneralAdmin && generalCount <= 1) {
      throw ApiError.badRequest('Debe existir al menos un administrador general.');
    }
  } else if (req.params.id !== req.user.id) {
    throw ApiError.forbidden('Todavía no existe un administrador general: solo puedes otorgarte este rol a ti mismo.');
  }

  const updated = await prisma.adminProfile.update({
    where: { userId: target.id },
    data: { isGeneralAdmin },
  });

  res.json({ ok: true, admin: { id: target.id, email: target.email, profile: updated } });
});

// Eliminación real y permanente de un administrador. A diferencia de
// clientController.deleteClient, aquí NO se puede simplemente cascadear:
// el modelo User acumula relaciones "quién hizo esto" (documentos subidos,
// estados de cuenta generados, invitaciones de capital, mensajes de chat y
// soporte) definidas como OBLIGATORIAS — borrar el usuario sin revisar esas
// relaciones fallaría por restricción de clave foránea, o peor, dejaría
// huérfano un registro de auditoría financiera. Por eso: exige que ya esté
// desactivado (nunca se elimina una cuenta todavía activa), nunca permite
// autoeliminarse ni eliminar a un administrador general (debe quitársele
// primero ese rango, lo que ya lo obliga a pasar por la regla de arriba), y
// antes de borrar comprueba que no tenga actividad histórica real.
const deleteAdmin = asyncHandler(async (req, res) => {
  const admin = await prisma.user.findUnique({ where: { id: req.params.id }, include: { adminProfile: true } });
  if (!admin || admin.role !== 'ADMIN') throw ApiError.notFound('Administrador no encontrado');

  if (admin.id === req.user.id) {
    throw ApiError.badRequest('No puedes eliminar tu propia cuenta.');
  }
  if (admin.adminProfile?.isGeneralAdmin) {
    throw ApiError.badRequest(
      'No puedes eliminar a un administrador general. Quítale primero el rango de administrador general.'
    );
  }
  if (admin.isActive) {
    throw ApiError.badRequest('Primero debes desactivar a este administrador antes de poder eliminarlo.');
  }

  const [documents, capitalIncreaseInvitations, capitalRescueInvitations, statements, chatMessages, supportMessages] =
    await Promise.all([
      prisma.document.count({ where: { uploadedByUserId: admin.id } }),
      prisma.capitalIncreaseInvitation.count({ where: { createdByUserId: admin.id } }),
      prisma.capitalRescueInvitation.count({ where: { createdByUserId: admin.id } }),
      prisma.statement.count({ where: { createdByUserId: admin.id } }),
      prisma.chatMessage.count({ where: { senderUserId: admin.id } }),
      prisma.supportCaseMessage.count({ where: { senderUserId: admin.id } }),
    ]);
  const hasActivity =
    documents + capitalIncreaseInvitations + capitalRescueInvitations + statements + chatMessages + supportMessages > 0;
  if (hasActivity) {
    throw ApiError.badRequest(
      'Este administrador tiene actividad registrada en el sistema (documentos subidos, estados de cuenta generados, invitaciones de capital o mensajes de chat/soporte) y no puede eliminarse sin perder ese historial. Déjalo desactivado en su lugar.'
    );
  }

  await prisma.user.delete({ where: { id: admin.id } });
  res.json({ ok: true });
});

module.exports = { listAdmins, createAdmin, updateAdmin, setGeneralAdmin, deleteAdmin };
