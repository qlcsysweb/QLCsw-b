const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken, cookieOptions } = require('../utils/token');
const { ensurePrincipalSubaccount } = require('../utils/subaccountProvisioning');
const { notifyAdmins } = require('../utils/notify');
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
  // El token también viaja en el cuerpo JSON (además de la cookie) porque
  // frontend y backend están en dominios distintos (Vercel/Render): la
  // cookie es "de terceros" para el navegador y muchos la bloquean por
  // defecto aunque tenga Secure/SameSite=None correctos. El frontend la usa
  // como respaldo vía header Authorization cuando la cookie no llega.
  res.json({ ok: true, token, user: shapeUser(user) });
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
  res.json({ ok: true, token, user: shapeUser(user) });
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

// El contrato ya NO forma parte del registro: se sustituye por la
// aceptación electrónica del Aviso de Privacidad y los Términos y
// Condiciones del Servicio de Copytrading (incluye la autorización de
// conexión API sin facultad de retiro). Las versiones vigentes se fijan
// aquí para poder auditar qué versión aceptó cada cliente y cuándo.
const PRIVACY_NOTICE_VERSION = '2026-09-12';
const TERMS_VERSION = '2026-09-12';

// CORRECCIÓN 5: registro público directo — crea la cuenta CLIENT completa
// (User + ClientProfile + Process/condiciones vacías listas para su primera
// subcuenta) y deja al visitante con sesión iniciada. Ya NO pasa por
// "prospecto" — ese flujo queda reservado para quien solo pide información.
const registerSchema = z.object({
  firstName: z.string().min(1, 'El nombre es obligatorio'),
  lastName: z.string().min(1, 'El apellido es obligatorio'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  // CORRECCIÓN 4: se captura una sola vez en el registro y se reutiliza
  // automáticamente en la generación del contrato — nunca se vuelve a pedir.
  nationality: z.string().min(1, 'La nacionalidad es obligatoria'),
  privacyAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar el Aviso de Privacidad para continuar.' }),
  }),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar los Términos y Condiciones para continuar.' }),
  }),
  apiAuthorizationAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debes autorizar la conexión API para continuar.' }),
  }),
});

const register = asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw ApiError.conflict('Ya existe una cuenta con este correo.');

  const passwordHash = await bcrypt.hash(data.password, 12);
  const acceptedAt = new Date();

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          firstName: data.firstName,
          lastName: data.lastName,
          nationality: data.nationality,
          privacyNoticeAcceptedAt: acceptedAt,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
          termsAcceptedAt: acceptedAt,
          termsVersion: TERMS_VERSION,
          apiAuthorizationAccepted: true,
          apiAuthorizationAcceptedAt: acceptedAt,
        },
      },
    },
    include: { clientProfile: true },
  });

  // GESTIÓN DINÁMICA DE SUBCUENTAS — el registro crea únicamente la cuenta
  // PRINCIPAL. Cualquier subcuenta adicional (hasta 20) nace de una
  // solicitud del cliente que un admin aprueba.
  await ensurePrincipalSubaccount(user.clientProfile.id);

  // NOMENCLATURA ÚNICA §9/§10 — el registro público NUNCA asigna su propia
  // nomenclatura (el campo no existe en registerSchema: nace null =
  // "PENDIENTE DE ASIGNACIÓN"). Por eso tampoco se prepara la carpeta de
  // Drive aquí todavía: crearla ahora obligaría a usar el ID interno como
  // nombre provisional ("nomenclatura inventada"). Queda con
  // driveSyncStatus="PENDING" (default del esquema) — cuando un admin
  // asigne la nomenclatura (assignUsername), ahí sí se prepara/renombra la
  // carpeta correspondiente. Si el cliente sube algo ANTES de eso, el flujo
  // de subida sigue funcionando (usa el ID como respaldo y se renombra
  // después) — nunca se bloquea al cliente por falta de nomenclatura.

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await notifyAdmins({
    title: 'Nuevo cliente registrado',
    message: `${data.firstName} ${data.lastName} (${data.email}) se registró en QLC. Todavía no tiene nomenclatura única asignada — actívala desde su ficha para completar su identificación y preparar su carpeta de Google Drive.`,
    type: 'info',
    templateKey: 'new_client_registered_admin',
    templateParams: { clientName: `${data.firstName} ${data.lastName}`, email: data.email, clientId: user.clientProfile.id },
  });

  const token = signToken(user);
  res.cookie(process.env.COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ ok: true, token, user: shapeUser(user) });
});

module.exports = { login, loginWithTwoFactor, logout, me, changePassword, register };
