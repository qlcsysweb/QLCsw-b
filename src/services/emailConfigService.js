/*
 * Lógica de configuración administrable de correo (Admin → Configuración →
 * Correo). Mismo patrón que driveConfigService.js: ninguna credencial se lee
 * ni se escribe aquí en texto completo — solo se referencia su presencia
 * (enmascarada).
 *
 * Soporta DOS métodos de envío, seleccionados por `authMethod`:
 *   - APP_PASSWORD: SMTP a smtp.gmail.com:465 (legado; requiere un host que
 *     no bloquee esos puertos salientes).
 *   - OAUTH2: Gmail API por HTTPS (puerto 443, nunca bloqueado) — necesario
 *     en Render free tier, que bloquea SMTP de forma permanente desde
 *     sept. 2025.
 */
const jwt = require('jsonwebtoken');
const {
  getEmailConfigRow,
  hasCredentials,
  sanitizeAppPassword,
  resolveCredentials,
  buildGoogleAuthUrl,
  exchangeOAuthCode,
  getAuthorizedEmail,
  verifyCredentials,
  sendMailUnified,
} = require('../config/emailConfig');
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('../utils/crypto');

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return '••••••••';
  const visible = user.slice(0, 3);
  return `${visible}${'•'.repeat(Math.max(user.length - 3, 3))}@${domain}`;
}

function maskGeneric(value) {
  if (!value) return null;
  if (value.length <= 10) return '••••••••';
  return `${value.slice(0, 6)}••••••••${value.slice(-4)}`;
}

async function getStatus() {
  const row = await getEmailConfigRow();
  const hasCreds = await hasCredentials();
  const effectiveUser = row.gmailUser || process.env.GMAIL_USER || null;

  const hasOwnCredentials =
    row.authMethod === 'OAUTH2'
      ? Boolean(row.gmailUser && row.googleOAuthRefreshTokenEncrypted)
      : Boolean(row.gmailUser && row.gmailAppPasswordEncrypted);

  return {
    // "Conectado" ya NO significa solo "hay credenciales guardadas": exige
    // que la ÚLTIMA prueba de conexión contra Gmail haya sido exitosa.
    // Mientras no se pruebe (o si la prueba falló), el estado real es
    // "desconectado", aunque haya una fila completa en la base de datos.
    isConnected: Boolean(hasCreds && row.isEnabled && row.lastTestStatus === 'OK'),
    isEnabled: row.isEnabled,
    hasCredentials: hasCreds,
    hasOwnCredentials,
    authMethod: row.authMethod,
    gmailUserMasked: maskEmail(effectiveUser),
    gmailSenderName: row.gmailSenderName || 'Quantum Liquidity Capital (QLC)',
    // Información transparente para el admin — no editable, QLC solo admite Gmail.
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    usingBootstrapEnv:
      row.authMethod === 'APP_PASSWORD' && !(row.gmailUser && row.gmailAppPasswordEncrypted) && Boolean(process.env.GMAIL_USER),
    hasGoogleOAuthClient: Boolean(row.googleOAuthClientId && row.googleOAuthClientSecretEncrypted),
    googleOAuthClientIdMasked: maskGeneric(row.googleOAuthClientId),
    oauthConnectedEmail: row.oauthConnectedEmail,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt,
    // Cualquier admin puede editar o desconectar — solo se deja registro
    // informativo de quién configuró/actualizó por última vez.
    configuredByUserId: row.configuredByUserId,
    isLockedByAnother: false,
  };
}

class OAuthConfigError extends Error {}

async function updateConfig(
  { gmailUser, gmailSenderName, gmailAppPassword, isEnabled, authMethod, googleClientId, googleClientSecret },
  userId
) {
  const row = await getEmailConfigRow();

  // Cambiar el Client ID/Secret de Google invalida cualquier refresh token
  // guardado (fue emitido para el par cliente ANTERIOR) — obliga a reconectar.
  const oauthClientChanged = Boolean((googleClientId && googleClientId.trim() !== row.googleOAuthClientId) || googleClientSecret);

  // Cambiar cualquier credencial (o el método activo) invalida cualquier
  // resultado de prueba anterior: un "OK" viejo no puede seguir mostrando
  // "Conectado" para una credencial que todavía no se probó.
  const credentialsChanged = Boolean(gmailUser || gmailAppPassword || authMethod || oauthClientChanged);

  return prisma.emailConfiguration.update({
    where: { id: row.id },
    data: {
      ...(gmailUser ? { gmailUser: gmailUser.trim() } : {}),
      ...(gmailSenderName !== undefined ? { gmailSenderName: gmailSenderName || null } : {}),
      ...(isEnabled !== undefined ? { isEnabled } : {}),
      // Google muestra la contraseña de aplicación con espacios ("xxxx xxxx
      // xxxx xxxx") — se limpian antes de cifrar para que quede guardada tal
      // como Gmail la espera en el login SMTP.
      ...(gmailAppPassword ? { gmailAppPasswordEncrypted: encrypt(sanitizeAppPassword(gmailAppPassword)) } : {}),
      ...(authMethod ? { authMethod } : {}),
      ...(googleClientId ? { googleOAuthClientId: googleClientId.trim() } : {}),
      ...(googleClientSecret ? { googleOAuthClientSecretEncrypted: encrypt(googleClientSecret.trim()) } : {}),
      ...(oauthClientChanged ? { googleOAuthRefreshTokenEncrypted: null, oauthConnectedEmail: null } : {}),
      ...(credentialsChanged ? { lastTestStatus: null, lastTestedAt: null, lastTestMessage: null } : {}),
      configuredByUserId: row.configuredByUserId || userId,
      updatedByUserId: userId,
    },
  });
}

async function disconnect(userId) {
  const row = await getEmailConfigRow();
  return prisma.emailConfiguration.update({
    where: { id: row.id },
    data: {
      isEnabled: false,
      configuredByUserId: null,
      updatedByUserId: userId,
      gmailUser: null,
      gmailAppPasswordEncrypted: null,
      authMethod: 'APP_PASSWORD',
      googleOAuthClientId: null,
      googleOAuthClientSecretEncrypted: null,
      googleOAuthRefreshTokenEncrypted: null,
      oauthConnectedEmail: null,
      lastTestStatus: null,
      lastTestedAt: null,
      lastTestMessage: null,
    },
  });
}

// Paso 1 del OAuth2: genera la URL de consentimiento de Google. Exige que ya
// se haya guardado el correo remitente esperado Y el Client ID/Secret de la
// app OAuth2 (Google Cloud Console) — así el paso 2 (completeOAuth) tiene
// contra qué comparar el correo que Google realmente autorice.
async function startOAuth(userId) {
  const row = await getEmailConfigRow();
  if (!row.gmailUser) {
    throw new OAuthConfigError(
      'Primero guarda el correo Gmail (Correo remitente) que va a autorizar el envío, antes de pulsar "Conectar con Google".'
    );
  }
  if (!row.googleOAuthClientId || !row.googleOAuthClientSecretEncrypted) {
    throw new OAuthConfigError(
      'Primero guarda el Client ID y el Client Secret de tu aplicación OAuth2 de Google Cloud, antes de pulsar "Conectar con Google".'
    );
  }

  const clientSecret = decryptOrThrow(row.googleOAuthClientSecretEncrypted, 'No se pudo descifrar el Client Secret guardado.');
  // sub=userId permite identificar quién inició el flujo sin depender de que
  // la cookie de sesión sobreviva la redirección completa a accounts.google.com
  // y de vuelta — el callback llega como navegación normal del navegador, sin
  // encabezados de autenticación propios de nuestra API.
  const state = jwt.sign({ purpose: 'email-oauth', sub: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = buildGoogleAuthUrl({ clientId: row.googleOAuthClientId, clientSecret, state });
  return { url };
}

// Paso 2: Google redirige aquí con ?code=...&state=.... Intercambia el code,
// confirma CON GOOGLE cuál correo autorizó realmente, y RECHAZA guardar nada
// si no coincide exactamente con el correo configurado (gmailUser) — nunca
// se envía "como" una cuenta distinta a la que el admin configuró.
async function completeOAuth({ code, state }) {
  if (!code || !state) {
    throw new OAuthConfigError('Falta el código de autorización o el parámetro state en la respuesta de Google.');
  }

  let payload;
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    throw new OAuthConfigError('El enlace de autorización expiró o no es válido. Vuelve a pulsar "Conectar con Google" desde el panel.');
  }
  if (payload.purpose !== 'email-oauth' || !payload.sub) {
    throw new OAuthConfigError('El enlace de autorización no es válido para esta operación.');
  }
  const userId = payload.sub;

  const row = await getEmailConfigRow();
  if (!row.gmailUser || !row.googleOAuthClientId || !row.googleOAuthClientSecretEncrypted) {
    throw new OAuthConfigError('La configuración de correo cambió antes de completar la conexión. Vuelve a intentarlo desde el panel.');
  }
  const clientSecret = decryptOrThrow(row.googleOAuthClientSecretEncrypted, 'No se pudo descifrar el Client Secret guardado.');

  let tokens;
  try {
    tokens = await exchangeOAuthCode({ clientId: row.googleOAuthClientId, clientSecret, code });
  } catch (err) {
    logSafeError('oauth-exchange', err);
    throw new OAuthConfigError(humanizeError(err));
  }

  if (!tokens.refresh_token) {
    throw new OAuthConfigError(
      `Google no devolvió un refresh token para ${row.gmailUser}. Esto pasa si esa cuenta ya había autorizado esta misma app antes sin revocarla. Entra a https://myaccount.google.com/permissions con la cuenta ${row.gmailUser}, quita el acceso de esta aplicación, y vuelve a pulsar "Conectar con Google".`
    );
  }

  let authorizedEmail;
  try {
    authorizedEmail = await getAuthorizedEmail({
      clientId: row.googleOAuthClientId,
      clientSecret,
      accessToken: tokens.access_token,
    });
  } catch (err) {
    logSafeError('oauth-userinfo', err);
    throw new OAuthConfigError('No se pudo confirmar con Google qué cuenta autorizó la conexión. Intenta nuevamente.');
  }

  if (!authorizedEmail) {
    throw new OAuthConfigError('Google no devolvió el correo autorizado (falta el permiso de email en el consentimiento otorgado).');
  }

  if (authorizedEmail.toLowerCase() !== row.gmailUser.trim().toLowerCase()) {
    throw new OAuthConfigError(
      `Autorizaste con la cuenta ${authorizedEmail}, pero el correo configurado en QLC es ${row.gmailUser}. No se guardó nada. ` +
        `Debes iniciar sesión en Google específicamente con ${row.gmailUser} (si tu navegador ya tiene otra cuenta de Google abierta, usa una ventana de incógnito) y volver a pulsar "Conectar con Google".`
    );
  }

  await prisma.emailConfiguration.update({
    where: { id: row.id },
    data: {
      authMethod: 'OAUTH2',
      googleOAuthRefreshTokenEncrypted: encrypt(tokens.refresh_token),
      oauthConnectedEmail: authorizedEmail,
      lastTestStatus: null,
      lastTestedAt: null,
      lastTestMessage: null,
      configuredByUserId: row.configuredByUserId || userId,
      updatedByUserId: userId,
    },
  });

  return { email: authorizedEmail };
}

function decryptOrThrow(encrypted, humanMessage) {
  try {
    return decrypt(encrypted);
  } catch (err) {
    throw new OAuthConfigError(humanMessage);
  }
}

// Log seguro: solo metadatos técnicos del error — nunca contraseñas, client
// secrets, refresh tokens ni access tokens (ninguno de estos aparece jamás
// en la forma de los errores de Nodemailer/Gaxios que se listan aquí).
function logSafeError(stage, err) {
  console.error(`[email-test:${stage}]`, {
    code: err?.code,
    responseCode: err?.responseCode,
    command: err?.command,
    smtpResponse: typeof err?.response === 'string' ? err.response.slice(0, 300) : undefined,
    oauthError: err?.response?.data?.error,
    oauthErrorDescription: err?.response?.data?.error_description,
    authorizedEmail: err?.authorizedEmail,
  });
}

// Fragmento técnico verificable que se agrega al mensaje mostrado en el
// panel — a pedido explícito, nunca se sustituye el error real por un texto
// genérico: el admin ve la causa humana Y el detalle crudo seguro.
function safeDiagnostic(err) {
  const parts = [];
  if (err?.code) parts.push(`código=${err.code}`);
  if (err?.responseCode) parts.push(`SMTP=${err.responseCode}`);
  if (err?.command) parts.push(`comando=${err.command}`);
  if (err?.response?.data?.error) parts.push(`oauth_error=${err.response.data.error}`);
  if (typeof err?.response === 'string' && err.response) parts.push(`respuesta de Gmail="${err.response.slice(0, 200)}"`);
  if (err?.authorizedEmail) parts.push(`correo_autorizado=${err.authorizedEmail}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

// Prueba real: resuelve y descifra las credenciales ACTUALMENTE guardadas
// (SMTP u OAuth2, según authMethod), verifica la conexión/token y solo si
// eso pasa envía un correo de prueba a la propia cuenta configurada (nunca a
// un cliente ni a otro administrador).
async function testConnection() {
  const row = await getEmailConfigRow();

  let creds;
  try {
    creds = await resolveCredentials();
  } catch (err) {
    logSafeError('decrypt', err);
    if (err.code === 'EDECRYPT') {
      return recordTestResult(
        row.id,
        'ERROR',
        `${err.message} (posible cambio de la clave de cifrado ENCRYPTION_KEY del servidor desde que se guardó). Vuelve a guardar la credencial desde este panel.`
      );
    }
    throw err;
  }

  if (!creds) {
    return recordTestResult(row.id, 'ERROR', 'Falta completar la configuración de correo (correo remitente y credencial) antes de poder probar la conexión.');
  }

  const methodLabel = creds.method === 'oauth2' ? 'Gmail API (OAuth2, HTTPS)' : 'SMTP (contraseña de aplicación)';
  const sourceNote =
    creds.source === 'env'
      ? ` [método: ${methodLabel}; usando GMAIL_USER/GMAIL_APP_PASSWORD del servidor (.env), no hay credenciales propias guardadas en el panel]`
      : ` [método: ${methodLabel}; usando la credencial guardada en el panel]`;

  try {
    await verifyCredentials(creds);
  } catch (err) {
    logSafeError('verify', err);
    return recordTestResult(row.id, 'ERROR', humanizeError(err) + safeDiagnostic(err) + sourceNote);
  }

  try {
    await sendMailUnified(creds, {
      to: creds.user,
      subject: 'QLC — Prueba de conexión de correo',
      text: 'Esta es una prueba de conexión enviada desde el panel de administración de QLC. Si la recibiste, el envío automático de correos está funcionando correctamente.',
    });
    return recordTestResult(
      row.id,
      'OK',
      `Conexión verificada (verify + envío real) y correo de prueba enviado a ${creds.user}.${sourceNote}`
    );
  } catch (err) {
    logSafeError('sendMail', err);
    return recordTestResult(row.id, 'ERROR', humanizeError(err) + safeDiagnostic(err) + sourceNote);
  }
}

async function recordTestResult(configId, status, message) {
  await prisma.emailConfiguration.update({
    where: { id: configId },
    data: { lastTestedAt: new Date(), lastTestStatus: status, lastTestMessage: message },
  });
  return { ok: status === 'OK', message };
}

function humanizeError(err) {
  if (err?.code === 'EOAUTH_EMAIL_MISMATCH') {
    return `El token de Google autorizado pertenece a ${err.authorizedEmail}, no a la cuenta configurada. Reconecta con "Conectar con Google" usando exactamente esa cuenta.`;
  }
  if (err?.code === 'EOAUTH_NO_TOKEN' || err?.code === 'EOAUTH_NO_EMAIL' || err?.code === 'EMISSING_BACKEND_URL') {
    return err.message;
  }
  const oauthError = err?.response?.data?.error;
  if (oauthError === 'invalid_grant') {
    return 'Google rechazó el refresh token guardado (fue revocado desde la cuenta de Google, expiró por inactividad prolongada, o cambió la contraseña de esa cuenta). Debes reconectar desde "Conectar con Google".';
  }
  if (oauthError) {
    return `Google rechazó la solicitud OAuth2 (${oauthError}${err.response?.data?.error_description ? ': ' + err.response.data.error_description : ''}).`;
  }
  const responseCode = err?.responseCode;
  if (responseCode === 535 || err?.code === 'EAUTH') {
    return 'Gmail rechazó las credenciales SMTP (usuario o contraseña de aplicación incorrectos, revocados, o verificación en dos pasos desactivada).';
  }
  if (['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'ENOTFOUND', 'EDNS'].includes(err?.code)) {
    return 'No pudimos conectar con los servidores de Gmail (smtp.gmail.com:465) desde este servidor — problema de red, DNS o firewall saliente, no de credenciales. Si el backend corre en un plan gratuito de Render, esto es un bloqueo PERMANENTE de su red: usa Gmail API (OAuth2) o sube de plan.';
  }
  if (/ssl|tls|certificate/i.test(err?.message || '')) {
    return 'Falló el cifrado SSL/TLS al conectar con smtp.gmail.com:465.';
  }
  // Nunca se sustituye por un texto genérico sin información: si no coincide
  // con un caso conocido, se muestra el mensaje real del error (nunca
  // incluye contraseñas ni secretos, solo describe el fallo de red/protocolo).
  return `No pudimos completar la prueba de correo. Detalle: ${err?.message ? String(err.message).slice(0, 300) : 'error desconocido'}.`;
}

module.exports = {
  getStatus,
  updateConfig,
  disconnect,
  testConnection,
  startOAuth,
  completeOAuth,
  OAuthConfigError,
};
