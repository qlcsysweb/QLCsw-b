const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/*
 * CORREGIR.xlsx ADMIN 06 — contraseña de seguridad exclusiva para eliminar
 * clientes. Solo el "administrador general" (AdminProfile.isGeneralAdmin)
 * puede configurarla o usarla; el hash nunca se devuelve al frontend.
 */

async function assertIsGeneralAdmin(req) {
  const profile = await prisma.adminProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile?.isGeneralAdmin) {
    throw ApiError.forbidden('Solo el administrador general puede realizar esta acción.');
  }
  return profile;
}

const getStatus = asyncHandler(async (req, res) => {
  await assertIsGeneralAdmin(req);
  const config = await prisma.securityConfiguration.findFirst();
  res.json({ ok: true, configured: Boolean(config?.clientDeletionPasswordHash) });
});

const setPasswordSchema = z.object({
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

const setPassword = asyncHandler(async (req, res) => {
  await assertIsGeneralAdmin(req);
  const { password } = setPasswordSchema.parse(req.body);
  const hash = await bcrypt.hash(password, 12);

  let config = await prisma.securityConfiguration.findFirst();
  config = config
    ? await prisma.securityConfiguration.update({
        where: { id: config.id },
        data: { clientDeletionPasswordHash: hash, updatedByUserId: req.user.id },
      })
    : await prisma.securityConfiguration.create({
        data: { clientDeletionPasswordHash: hash, updatedByUserId: req.user.id },
      });

  res.json({ ok: true, configured: Boolean(config.clientDeletionPasswordHash) });
});

// Usado internamente por clientController.deleteClient — nunca expuesto
// como ruta propia.
async function verifyClientDeletionPassword(userId, password) {
  const profile = await prisma.adminProfile.findUnique({ where: { userId } });
  if (!profile?.isGeneralAdmin) {
    throw ApiError.forbidden('Solo el administrador general puede eliminar clientes.');
  }
  const config = await prisma.securityConfiguration.findFirst();
  if (!config?.clientDeletionPasswordHash) {
    throw ApiError.badRequest(
      'Todavía no se ha configurado la contraseña de seguridad para eliminar clientes. Ve a Configuración → Seguridad.'
    );
  }
  if (!password) {
    throw ApiError.badRequest('Debes indicar la contraseña de seguridad para eliminar un cliente.');
  }
  const matches = await bcrypt.compare(password, config.clientDeletionPasswordHash);
  if (!matches) {
    throw ApiError.forbidden('Contraseña de seguridad incorrecta.');
  }
}

module.exports = { getStatus, setPassword, verifyClientDeletionPassword };
