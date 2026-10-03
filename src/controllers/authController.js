const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken, cookieOptions, clearCookieOptions } = require('../utils/token');
const { ensurePrincipalSubaccount } = require('../utils/subaccountProvisioning');
const { notifyAdmins } = require('../utils/notify');
const { resolveActiveReferrer, logAffiliateEvent } = require('../services/affiliateService');
const { sendRegistrationCode, checkRegistrationCode, consumeRegistrationCode } = require('../services/emailVerificationService');
const {
  isTwoFactorGloballyEnabled,
  verifyToken,
  decryptSecret,
  verifyTwoFactorChallenge,
  passwordFingerprint,
  signPasswordResetToken,
  verifyPasswordResetToken,
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
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    // 2FA obligatorio: true = debe configurar Google Authenticator antes de
    // usar el panel (el backend ya bloquea el resto de rutas, ver auth.js).
    twoFactorSetupRequired: isTwoFactorGloballyEnabled() && !user.twoFactorEnabled,
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

  // ACCESO CON CONTRASEÑA **O** CON GOOGLE AUTHENTICATOR (decisión de QLC):
  // la contraseña correcta basta para entrar; el código de Authenticator es
  // la vía alternativa (ver loginWithCode). Si la cuenta todavía no registró
  // su Authenticator, la sesión queda limitada a registrarlo
  // (twoFactorSetupRequired + middleware/auth.js) y no puede omitirlo.
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

// INICIO DE SESIÓN CON GOOGLE AUTHENTICATOR (sin contraseña) — correo +
// código de 6 dígitos. Solo para cuentas que ya registraron su Authenticator.
// Mismo error genérico para correo inexistente, cuenta sin Authenticator o
// código incorrecto. Un código ya usado no se acepta otra vez (anti-replay
// en memoria durante su ventana de validez).
const loginCodeSchema = z.object({
  email: z.string().email('Email inválido'),
  code: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
});
const usedLoginCodes = new Map();
function consumeLoginCode(userId, code) {
  const now = Date.now();
  for (const [key, expires] of usedLoginCodes) if (expires < now) usedLoginCodes.delete(key);
  const key = `${userId}:${code}`;
  if (usedLoginCodes.has(key)) return false;
  usedLoginCodes.set(key, now + 2 * 60 * 1000);
  return true;
}

const loginWithCode = asyncHandler(async (req, res) => {
  if (!isTwoFactorGloballyEnabled()) throw ApiError.forbidden('2FA no está disponible');
  const { email, code } = loginCodeSchema.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { email },
    include: { adminProfile: true, clientProfile: true },
  });
  const secret = user?.isActive && user.twoFactorEnabled ? decryptSecret(user.twoFactorSecretEncrypted) : null;
  if (!secret || !verifyToken(secret, code) || !consumeLoginCode(user.id, code)) {
    throw ApiError.unauthorized('Correo o código de Google Authenticator incorrectos.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = signToken(user);
  res.cookie(process.env.COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true, token, user: shapeUser(user) });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie(process.env.COOKIE_NAME, clearCookieOptions());
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

// Los textos son editables por el ADMIN (CMS → sección "legal"). La versión
// aceptada es la fecha/hora de la última edición del texto vigente, para
// poder auditar exactamente qué versión aceptó cada cliente; si nunca se ha
// editado, es la versión oficial original.
async function currentLegalVersions() {
  const rows = await prisma.publicContent.findMany({
    where: { section: 'legal', key: { in: ['privacy_title', 'privacy_body', 'terms_title', 'terms_body'] } },
    select: { key: true, updatedAt: true },
  });
  const latest = (prefix) => {
    const dates = rows.filter((r) => r.key.startsWith(prefix)).map((r) => r.updatedAt.getTime());
    return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  };
  return { privacy: latest('privacy_') || PRIVACY_NOTICE_VERSION, terms: latest('terms_') || TERMS_VERSION };
}

// CORRECCIÓN 5: registro público directo — crea la cuenta CLIENT completa
// (User + ClientProfile + Process/condiciones vacías listas para su primera
// subcuenta) y deja al visitante con sesión iniciada. Ya NO pasa por
// "prospecto" — ese flujo queda reservado para quien solo pide información.
// REGISTRO POR INVITACIÓN — el registro externo exige un código de afiliado
// válido y ACTIVO (el visitante solo envía el código; nunca un ID). El backend
// lo valida otra vez aquí aunque el frontend ya lo haya validado.
const registerSchema = z.object({
  affiliateCode: z
    .string({ required_error: 'Para registrarte en QLC necesitas un código o enlace de afiliación válido.' })
    .trim()
    .min(1, 'Para registrarte en QLC necesitas un código o enlace de afiliación válido.')
    .max(64),
  firstName: z.string().min(1, 'El nombre es obligatorio'),
  lastName: z.string().min(1, 'El apellido es obligatorio'),
  email: z.string().trim().email('Email inválido'),
  // Código de 6 dígitos enviado al correo (confirma que el correo es real
  // y está bien escrito antes de crear la cuenta).
  emailCode: z
    .string({ required_error: 'Escribe el código de verificación que enviamos a tu correo.' })
    .trim()
    .regex(/^\d{6}$/, 'El código de verificación debe tener 6 dígitos.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
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

// ENVIAR CÓDIGO DE VERIFICACIÓN — solo para un registro por invitación válido
// (exige el código de afiliación activo) y un correo todavía no registrado.
const sendRegisterCodeSchema = z.object({
  email: z.string().trim().email('Email inválido'),
  affiliateCode: z.string({ required_error: 'Para registrarte en QLC necesitas un código o enlace de afiliación válido.' }).trim().min(1).max(64),
  language: z.enum(['es', 'en']).optional(),
});

const sendRegisterCode = asyncHandler(async (req, res) => {
  const data = sendRegisterCodeSchema.parse(req.body);
  await resolveActiveReferrer(prisma, data.affiliateCode);
  const existing = await prisma.user.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' } }, select: { id: true } });
  if (existing) throw ApiError.conflict('Ya existe una cuenta con este correo.');
  const { expiresAt } = await sendRegistrationCode(data.email, data.language);
  res.json({ ok: true, expiresAt });
});

const register = asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);

  // Validación temprana (sin crear nada si el código no sirve).
  await resolveActiveReferrer(prisma, data.affiliateCode);

  const existing = await prisma.user.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' } }, select: { id: true } });
  if (existing) throw ApiError.conflict('Ya existe una cuenta con este correo.');

  // El correo debe estar confirmado con el código que se le envió.
  const emailCodeId = await checkRegistrationCode(data.email, data.emailCode);

  const passwordHash = await bcrypt.hash(data.password, 12);
  const acceptedAt = new Date();
  const legalVersions = await currentLegalVersions();

  // Usuario + perfil + afiliador DIRECTO en la MISMA transacción: el código
  // se vuelve a resolver dentro (por si se desactivó entre tanto) y nunca
  // queda una cuenta sin su relación de afiliación. Un doble submit choca
  // con el índice único del correo y responde 409 (nunca dos cuentas).
  let user;
  let referrer;
  try {
    ({ user, referrer } = await prisma.$transaction(async (tx) => {
      const activeReferrer = await resolveActiveReferrer(tx, data.affiliateCode);
      await consumeRegistrationCode(tx, emailCodeId);
      const created = await tx.user.create({
        data: {
          email: data.email,
          emailVerifiedAt: acceptedAt,
          passwordHash,
          role: 'CLIENT',
          clientProfile: {
            create: {
              firstName: data.firstName,
              lastName: data.lastName,
              privacyNoticeAcceptedAt: acceptedAt,
              privacyNoticeVersion: legalVersions.privacy,
              termsAcceptedAt: acceptedAt,
              termsVersion: legalVersions.terms,
              apiAuthorizationAccepted: true,
              apiAuthorizationAcceptedAt: acceptedAt,
              referredByClientId: activeReferrer.id,
              referredAt: acceptedAt,
              referralSource: 'AFFILIATE_LINK',
              // Código exacto utilizado en el registro (evidencia de la atribución).
              referralCodeUsed: activeReferrer.affiliateCode,
            },
          },
        },
        include: { clientProfile: true },
      });
      return { user: created, referrer: activeReferrer };
    }));
  } catch (err) {
    if (err.code === 'P2002') throw ApiError.conflict('Ya existe una cuenta con este correo.');
    throw err;
  }
  await logAffiliateEvent(prisma, {
    action: 'CLIENT_REGISTERED_WITH_CODE',
    clientId: user.clientProfile.id,
    details: { referrerClientId: referrer.id, affiliateCode: referrer.affiliateCode },
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

// RESTABLECER CONTRASEÑA DESDE EL LOGIN (sin sesión) — correo + código de
// Google Authenticator. Mismo error genérico para correo inexistente, cuenta
// inactiva, cuenta sin Authenticator o código incorrecto: nunca revela si un
// correo está registrado. Con el código válido se emite un token temporal
// de un solo uso para fijar la contraseña nueva.
const resetVerifySchema = z.object({
  email: z.string().email('Email inválido'),
  code: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
});

const verifyPasswordReset = asyncHandler(async (req, res) => {
  const { email, code } = resetVerifySchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const secret = user?.isActive && user.twoFactorEnabled ? decryptSecret(user.twoFactorSecretEncrypted) : null;
  if (!secret || !verifyToken(secret, code)) {
    throw ApiError.unauthorized('Correo o código de Google Authenticator incorrectos.');
  }
  res.json({ ok: true, resetToken: signPasswordResetToken(user) });
});

const resetCompleteSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres').max(200),
});

const completePasswordReset = asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = resetCompleteSchema.parse(req.body);
  const expired = () => ApiError.unauthorized('La verificación para restablecer la contraseña expiró. Vuelve a empezar.');
  let payload;
  try {
    payload = verifyPasswordResetToken(resetToken);
  } catch {
    throw expired();
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  // Uso único: si la contraseña ya cambió, la huella deja de coincidir.
  if (!user || !user.isActive || payload.pwf !== passwordFingerprint(user.passwordHash)) throw expired();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true, message: 'Contraseña actualizada correctamente.' });
});

module.exports = {
  login,
  loginWithTwoFactor,
  loginWithCode,
  logout,
  me,
  changePassword,
  register,
  sendRegisterCode,
  verifyPasswordReset,
  completePasswordReset,
};
