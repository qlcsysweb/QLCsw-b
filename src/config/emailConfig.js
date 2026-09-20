const { google } = require('googleapis');
const prisma = require('./prisma');
const { decrypt } = require('../utils/crypto');

/*
 * AUDITORÍA QLC PARTE 13 — credenciales de Gmail resueltas igual que Google
 * Drive (config/googleDrive.js): preferimos lo guardado desde el panel
 * (Admin → Configuración → Correo, cifrado en EmailConfiguration), y si esa
 * fila no tiene credenciales propias caemos al bootstrap por variables de
 * entorno (GMAIL_USER / GMAIL_APP_PASSWORD). Así la integración ya existente
 * nunca se rompe mientras no haya credenciales configuradas en ningún lado.
 *
 * CORRECCIÓN Render free tier — Render bloquea de forma permanente los
 * puertos SMTP salientes (25/465/587) en sus Web Services gratuitos
 * (https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports).
 * Por eso se agrega un segundo método de envío, Gmail API vía OAuth2, que
 * viaja por HTTPS (puerto 443) y nunca choca con ese bloqueo. `authMethod`
 * en la fila decide cuál de los dos se usa; el resto del sistema (testConnection,
 * emailService) llama siempre a las funciones de este archivo sin conocer el
 * detalle de transporte.
 */

const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

async function getEmailConfigRow() {
  let row = await prisma.emailConfiguration.findFirst();
  if (!row) {
    row = await prisma.emailConfiguration.create({
      data: { gmailUser: process.env.GMAIL_USER || null },
    });
  }
  return row;
}

// Google muestra la contraseña de aplicación con espacios visuales
// ("xxxx xxxx xxxx xxxx") pero la contraseña real no los lleva. Si se
// guarda o se lee con esos espacios, Gmail rechaza el login SMTP (535) aunque
// el resto de la configuración sea correcta. Se limpia siempre antes de
// autenticar, sin importar si el espacio quedó guardado por error en el
// pasado (fila existente) o viene de una variable de entorno con comillas.
function sanitizeAppPassword(value) {
  return (value || '').replace(/\s+/g, '');
}

function decryptOrThrow(encrypted, humanMessage) {
  try {
    return decrypt(encrypted);
  } catch (err) {
    const decryptError = new Error(humanMessage);
    decryptError.code = 'EDECRYPT';
    throw decryptError;
  }
}

async function resolveCredentials() {
  const row = await getEmailConfigRow();

  if (row.authMethod === 'OAUTH2') {
    if (!row.isEnabled) return null;
    if (!row.gmailUser || !row.googleOAuthClientId || !row.googleOAuthClientSecretEncrypted || !row.googleOAuthRefreshTokenEncrypted) {
      return null;
    }
    const clientSecret = decryptOrThrow(
      row.googleOAuthClientSecretEncrypted,
      'No se pudo descifrar el Client Secret de Google guardado.'
    );
    const refreshToken = decryptOrThrow(
      row.googleOAuthRefreshTokenEncrypted,
      'No se pudo descifrar el refresh token de Google guardado.'
    );
    return {
      method: 'oauth2',
      user: row.gmailUser.trim(),
      senderName: row.gmailSenderName || 'Quantum Liquidity Capital (QLC)',
      clientId: row.googleOAuthClientId,
      clientSecret,
      refreshToken,
      source: 'db',
    };
  }

  if (row.gmailUser && row.gmailAppPasswordEncrypted && row.isEnabled) {
    const decrypted = decryptOrThrow(
      row.gmailAppPasswordEncrypted,
      'No se pudo descifrar la contraseña de aplicación guardada.'
    );
    return {
      method: 'app_password',
      user: row.gmailUser.trim(),
      senderName: row.gmailSenderName || 'Quantum Liquidity Capital (QLC)',
      appPassword: sanitizeAppPassword(decrypted),
      source: 'db',
    };
  }
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return {
      method: 'app_password',
      user: process.env.GMAIL_USER.trim(),
      senderName: 'Quantum Liquidity Capital (QLC)',
      appPassword: sanitizeAppPassword(process.env.GMAIL_APP_PASSWORD),
      source: 'env',
    };
  }
  return null;
}

// Solo comprueba PRESENCIA de credenciales (fila con datos, o variables de
// entorno definidas) — nunca intenta descifrar, para que un problema de
// descifrado no tumbe el estado general del panel con un 500. El descifrado
// real solo ocurre en resolveCredentials(), dentro de testConnection()/envío,
// donde un fallo sí se reporta con su causa exacta.
async function hasCredentials() {
  const row = await getEmailConfigRow();
  if (row.authMethod === 'OAUTH2') {
    return Boolean(
      row.isEnabled &&
        row.gmailUser &&
        row.googleOAuthClientId &&
        row.googleOAuthClientSecretEncrypted &&
        row.googleOAuthRefreshTokenEncrypted
    );
  }
  if (row.gmailUser && row.gmailAppPasswordEncrypted && row.isEnabled) return true;
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

// Único punto donde se arma el transporte SMTP de Gmail (método legado), para
// que "Guardar/Probar" y el envío real de notificaciones nunca puedan
// divergir en host/puerto/seguridad.
function createGmailTransport(creds) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: creds.user, pass: creds.appPassword },
  });
}

// --- Gmail API vía OAuth2 (HTTPS, puerto 443 — nunca bloqueado por Render) ---

function oauthRedirectUri() {
  const base = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/+$/, '');
  if (!base) {
    const err = new Error(
      'Falta configurar BACKEND_PUBLIC_URL en el servidor (URL pública del backend, sin barra final) para poder usar Gmail API con OAuth2.'
    );
    err.code = 'EMISSING_BACKEND_URL';
    throw err;
  }
  return `${base}/api/email-config/oauth/callback`;
}

function createOAuth2Client(clientId, clientSecret) {
  return new google.auth.OAuth2(clientId, clientSecret, oauthRedirectUri());
}

// Genera la URL de consentimiento de Google. `prompt: 'consent'` fuerza que
// Google reemita un refresh_token SIEMPRE (no solo la primera vez que esa
// cuenta autoriza la app), para que reconectar nunca falle por falta de uno.
function buildGoogleAuthUrl({ clientId, clientSecret, state }) {
  const client = createOAuth2Client(clientId, clientSecret);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_OAUTH_SCOPES,
    state,
  });
}

async function exchangeOAuthCode({ clientId, clientSecret, code }) {
  const client = createOAuth2Client(clientId, clientSecret);
  const { tokens } = await client.getToken(code);
  return tokens; // { access_token, refresh_token?, expiry_date, scope, ... }
}

// Confirma, usando el propio access token recién emitido, CUÁL correo de
// Google autorizó realmente la conexión (requiere el scope userinfo.email
// solicitado en buildGoogleAuthUrl). Es la única forma confiable de saber
// esto — Gmail API en sí no expone el email con el scope gmail.send solo.
async function getAuthorizedEmail({ clientId, clientSecret, accessToken }) {
  const client = createOAuth2Client(clientId, clientSecret);
  const info = await client.getTokenInfo(accessToken);
  return info.email || null;
}

// Igual que transport.verify() de Nodemailer, pero para OAuth2: fuerza a
// canjear el refresh_token por un access_token nuevo (falla con invalid_grant
// si el refresh token fue revocado/expiró) y confirma que el correo
// autorizado sigue siendo el configurado.
async function verifyOAuth2(creds) {
  const client = createOAuth2Client(creds.clientId, creds.clientSecret);
  client.setCredentials({ refresh_token: creds.refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) {
    const err = new Error('Google no devolvió un access token válido.');
    err.code = 'EOAUTH_NO_TOKEN';
    throw err;
  }
  const info = await client.getTokenInfo(token);
  if (!info.email) {
    const err = new Error('El token no incluye el correo autorizado (falta el permiso de email).');
    err.code = 'EOAUTH_NO_EMAIL';
    throw err;
  }
  if (info.email.toLowerCase() !== creds.user.toLowerCase()) {
    const err = new Error(`El token autorizado pertenece a ${info.email}, no a ${creds.user}.`);
    err.code = 'EOAUTH_EMAIL_MISMATCH';
    err.authorizedEmail = info.email;
    throw err;
  }
  // El correo puede coincidir y el token seguir siendo inútil para enviar:
  // Google concede EXACTAMENTE los scopes que el consentimiento realmente
  // autorizó, sin importar cuáles pidió el código. Si `gmail.send` no está
  // agregado en Google Cloud Console → OAuth consent screen → Data access,
  // Google lo omite del token sin lanzar ningún error — el "Probar conexión"
  // pasaría igual (el correo es correcto) y solo el envío real fallaría con
  // "insufficient authentication scopes". Se detecta aquí para que la prueba
  // de conexión ya lo reporte, en vez de descubrirlo con un envío real fallido.
  const grantedScopes = info.scopes || [];
  if (!grantedScopes.includes('https://www.googleapis.com/auth/gmail.send')) {
    const err = new Error(
      `Google autorizó la cuenta ${info.email} pero SIN el permiso de envío (gmail.send). Esto pasa cuando ese permiso no está agregado en Google Cloud Console → OAuth consent screen → Data access. Agrega el scope "https://www.googleapis.com/auth/gmail.send" ahí, guarda, y vuelve a pulsar "Conectar con Google" en este panel.`
    );
    err.code = 'EOAUTH_MISSING_SCOPE';
    err.grantedScopes = grantedScopes;
    throw err;
  }
  return { accessToken: token, authorizedEmail: info.email };
}

function encodeMimeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function buildRawMimeMessage({ from, to, subject, text }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text,
  ];
  const raw = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64');
  // Gmail API exige base64url (RFC 4648 §5), no base64 estándar.
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaGmailApi(creds, { to, subject, text }) {
  const client = createOAuth2Client(creds.clientId, creds.clientSecret);
  client.setCredentials({ refresh_token: creds.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: client });
  const from = `"${creds.senderName}" <${creds.user}>`;
  const raw = buildRawMimeMessage({ from, to, subject, text });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return res.data;
}

// Punto único de envío real, usado tanto por el test del panel como por
// emailService.js (notificaciones, bienvenida, estados de cuenta) — así
// "Guardar/Probar" y el envío real de la plataforma NUNCA pueden divergir,
// sin importar cuál de los dos métodos (SMTP u OAuth2) esté activo.
async function sendMailUnified(creds, { to, subject, text }) {
  if (creds.method === 'oauth2') {
    return sendViaGmailApi(creds, { to, subject, text });
  }
  const transport = createGmailTransport(creds);
  const from = `"${creds.senderName}" <${creds.user}>`;
  return transport.sendMail({ from, to, subject, text });
}

// Equivalente a transport.verify() sin importar el método activo.
async function verifyCredentials(creds) {
  if (creds.method === 'oauth2') {
    return verifyOAuth2(creds);
  }
  const transport = createGmailTransport(creds);
  await transport.verify();
  return true;
}

module.exports = {
  getEmailConfigRow,
  resolveCredentials,
  hasCredentials,
  sanitizeAppPassword,
  createGmailTransport,
  GMAIL_OAUTH_SCOPES,
  buildGoogleAuthUrl,
  exchangeOAuthCode,
  getAuthorizedEmail,
  verifyCredentials,
  sendMailUnified,
};
