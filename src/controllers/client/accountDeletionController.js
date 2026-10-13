const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { clearCookieOptions } = require('../../utils/token');
const { verifyToken, decryptSecret } = require('../../utils/twoFactor');
const { notifyAdmins } = require('../../utils/notify');

/*
 * ELIMINACIÓN DE CUENTA — autoservicio EXCLUSIVO del titular (ADMIN no puede
 * eliminar cuentas de clientes, ver clientController.rejectClientDeletion).
 *
 * El cliente se identifica SOLO por su sesión (req.user / req.clientProfile,
 * resueltos del token en clientRoutes) — el body no trae ningún ID. Exige
 * SIEMPRE las dos verificaciones: contraseña actual contra el hash guardado
 * Y código de Google Authenticator del 2FA existente.
 *
 * No es un borrado: se registra la solicitud y se desactiva el acceso
 * (User.isActive=false). requireAuth comprueba isActive en cada petición,
 * así que todos sus tokens/sesiones dejan de servir en ese instante, y el
 * login (contraseña o código) también lo rechaza. Sus documentos, estados
 * de cuenta, pagos, carpeta de Drive y relaciones de afiliación (de ida y de
 * vuelta) quedan intactos hasta su tratamiento conforme a la política de
 * retención. Su liga de afiliación deja de aceptar registros nuevos porque
 * resolveActiveReferrer exige un usuario activo.
 */

const GENERIC_DENIED = 'La contraseña o el código de Google Authenticator no son correctos.';

const schema = z.object({
  password: z.string({ required_error: 'Escribe tu contraseña actual.' }).min(1, 'Escribe tu contraseña actual.').max(200),
  code: z
    .string({ required_error: 'Escribe el código de Google Authenticator.' })
    .trim()
    .regex(/^\d{6}$/, 'El código de Google Authenticator debe tener 6 dígitos.'),
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'Debes confirmar que entiendes que perderás el acceso a tu cuenta.' }),
  }),
});

// Un código TOTP ya usado no se acepta otra vez durante su ventana de validez.
const usedCodes = new Map();
function consumeCode(userId, code) {
  const now = Date.now();
  for (const [key, expires] of usedCodes) if (expires < now) usedCodes.delete(key);
  const key = `${userId}:${code}`;
  if (usedCodes.has(key)) return false;
  usedCodes.set(key, now + 2 * 60 * 1000);
  return true;
}

const requestAccountDeletion = asyncHandler(async (req, res) => {
  const { password, code } = schema.parse(req.body);
  const profile = req.clientProfile;

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, role: true, isActive: true, passwordHash: true, twoFactorEnabled: true, twoFactorSecretEncrypted: true },
  });
  // clientRoutes ya exige rol CLIENT; defensa adicional por si se reutiliza.
  if (!user || user.role !== 'CLIENT' || user.id !== profile.userId) {
    throw ApiError.forbidden('Solo el titular de la cuenta puede solicitar su eliminación.');
  }
  if (profile.accountDeletionStatus) {
    throw ApiError.conflict('Ya registramos una solicitud de eliminación para esta cuenta.');
  }
  if (!user.twoFactorEnabled || !user.twoFactorSecretEncrypted) {
    throw ApiError.forbidden('Debes tener activa la verificación en dos pasos (Google Authenticator) para eliminar tu cuenta.');
  }

  // Ambas verificaciones se evalúan siempre; la respuesta no revela cuál falló.
  // 403 (no 401): un 401 haría que el portal cerrara la sesión por un simple error de escritura.
  const validPassword = await bcrypt.compare(password, user.passwordHash);
  let secret = null;
  try {
    secret = decryptSecret(user.twoFactorSecretEncrypted);
  } catch {
    secret = null;
  }
  const validCode = Boolean(secret) && verifyToken(secret, code);
  if (!validPassword || !validCode || !consumeCode(user.id, code)) {
    throw ApiError.forbidden(GENERIC_DENIED);
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Condicional: un doble clic o dos pestañas solo registran UNA solicitud.
    const { count } = await tx.clientProfile.updateMany({
      where: { id: profile.id, userId: user.id, accountDeletionStatus: null },
      data: {
        accountDeletionStatus: 'REQUESTED',
        accountDeletionRequestedAt: now,
        accountDeactivatedAt: now,
        status: 'INACTIVE',
      },
    });
    if (count === 0) throw ApiError.conflict('Ya registramos una solicitud de eliminación para esta cuenta.');
    await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
  });

  // Aviso a los administradores (registro administrativo, sin opción de borrar).
  const clientName = `${profile.firstName} ${profile.lastName}`.trim();
  await notifyAdmins({
    title: 'Solicitud de eliminación de cuenta',
    message: `${clientName} (${profile.username || 'sin nomenclatura'}) solicitó eliminar su cuenta tras verificar contraseña y Google Authenticator. Su acceso quedó desactivado; sus datos se conservan hasta su tratamiento conforme a la política aplicable.`,
    type: 'warning',
    templateKey: 'account_deletion_requested_admin',
    templateParams: { clientId: profile.id, clientName, username: profile.username || '' },
  }).catch(() => {});

  res.clearCookie(process.env.COOKIE_NAME, clearCookieOptions());
  res.json({
    ok: true,
    requestedAt: now,
    message:
      'Hemos recibido tu solicitud de eliminación de cuenta. Tu acceso a la plataforma ha sido desactivado. La eliminación de tus datos se realizará conforme a los plazos y obligaciones aplicables.',
  });
});

module.exports = { requestAccountDeletion };
