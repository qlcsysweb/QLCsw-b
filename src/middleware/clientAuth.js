const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/*
 * Resuelve el ClientProfile del usuario autenticado y lo adjunta a
 * req.clientProfile. Todas las rutas del portal cliente usan este ID
 * resuelto desde el token — NUNCA un :clientId recibido en la URL — para
 * que un cliente jamás pueda acceder a los datos de otro cliente (IDOR).
 */
const resolveOwnClientProfile = asyncHandler(async (req, res, next) => {
  const clientProfile = await prisma.clientProfile.findUnique({ where: { userId: req.user.id } });
  if (!clientProfile) throw ApiError.notFound('Perfil de cliente no encontrado');
  req.clientProfile = clientProfile;
  next();
});

module.exports = { resolveOwnClientProfile };
