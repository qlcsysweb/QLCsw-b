const { google } = require('googleapis');
const prisma = require('./prisma');
const { decrypt } = require('../utils/crypto');

/*
 * IMPLEMENTACIÓN DEFINITIVA DE GOOGLE DRIVE — QLC usa el Google Drive
 * PERSONAL de sistemaweb.qlc@gmail.com (sin Google Workspace), así que el
 * backend nunca puede usar una cuenta de servicio para escribir ahí
 * directamente: solo OAuth2 con el consentimiento de esa cuenta permite
 * actuar sobre SU Drive. Mismo patrón ya probado en config/emailConfig.js
 * (Gmail): el admin autoriza una vez desde el panel, el refresh token queda
 * cifrado en DriveConfiguration, y el resto del sistema (driveStorageService)
 * llama siempre a las funciones de este archivo sin conocer el detalle de
 * autenticación.
 *
 * Scope: "drive" completo (antes se usaba "drive.file", más restringido).
 * CORRECCIÓN — "drive.file" solo permite ver archivos/carpetas que la propia
 * app crea o que el usuario abre explícitamente con ella desde un selector
 * de Google; NUNCA una carpeta ya existente creada a mano desde
 * drive.google.com (como la carpeta raíz "QLC" real de sistemaweb.qlc@gmail.com),
 * aunque el Folder ID sea correcto y pertenezca a la misma cuenta — Google
 * responde 404 "File not found" en ese caso, indistinguible de un ID
 * inexistente. El scope "drive" da acceso completo al Drive de la cuenta
 * autorizada, permitiendo ver/usar esa carpeta y sus subcarpetas. Es un
 * scope "sensible" (más difícil de verificar ante Google si se publica la
 * app, pero QLC la mantiene en modo de prueba con sistemaweb.qlc@gmail.com
 * como usuario de prueba, así que no hace falta verificación).
 */
const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

async function getDriveConfigRow() {
  let row = await prisma.driveConfiguration.findFirst();
  if (!row) {
    row = await prisma.driveConfiguration.create({ data: {} });
  }
  return row;
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
  const row = await getDriveConfigRow();
  if (!row.isEnabled) return null;
  if (!row.googleOAuthClientId || !row.googleOAuthClientSecretEncrypted || !row.googleOAuthRefreshTokenEncrypted) {
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
    clientId: row.googleOAuthClientId,
    clientSecret,
    refreshToken,
    connectedEmail: row.oauthConnectedEmail,
  };
}

// Solo comprueba PRESENCIA de credenciales — nunca intenta descifrar (ver
// mismo patrón en config/emailConfig.js: un fallo de descifrado no debe
// tumbar el estado general del panel con un 500).
async function hasCredentials() {
  const row = await getDriveConfigRow();
  return Boolean(
    row.isEnabled &&
      row.googleOAuthClientId &&
      row.googleOAuthClientSecretEncrypted &&
      row.googleOAuthRefreshTokenEncrypted
  );
}

async function resolveRootFolderId() {
  const row = await getDriveConfigRow();
  return row.rootFolderId || null;
}

async function isConfigured() {
  const creds = await resolveCredentials();
  if (!creds) return false;
  const folderId = await resolveRootFolderId();
  return Boolean(folderId);
}

function oauthRedirectUri() {
  const base = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/+$/, '');
  if (!base) {
    const err = new Error(
      'Falta configurar BACKEND_PUBLIC_URL en el servidor (URL pública del backend, sin barra final) para poder conectar Google Drive con OAuth2.'
    );
    err.code = 'EMISSING_BACKEND_URL';
    throw err;
  }
  return `${base}/api/drive-config/oauth/callback`;
}

function createOAuth2Client(clientId, clientSecret) {
  return new google.auth.OAuth2(clientId, clientSecret, oauthRedirectUri());
}

// `prompt: 'consent'` fuerza que Google reemita un refresh_token SIEMPRE
// (no solo la primera vez que esa cuenta autoriza la app).
function buildGoogleAuthUrl({ clientId, clientSecret, state }) {
  const client = createOAuth2Client(clientId, clientSecret);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_DRIVE_SCOPES,
    state,
  });
}

async function exchangeOAuthCode({ clientId, clientSecret, code }) {
  const client = createOAuth2Client(clientId, clientSecret);
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function getAuthorizedEmail({ clientId, clientSecret, accessToken }) {
  const client = createOAuth2Client(clientId, clientSecret);
  const info = await client.getTokenInfo(accessToken);
  return info.email || null;
}

// Scope real que necesita esta app — un solo lugar para no repetir el
// string y arriesgar que una actualización futura deje una comparación
// desactualizada en otro archivo (ver driveConfigService.js).
const REQUIRED_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

// Verifica que el refresh token siga siendo válido Y que el scope "drive"
// completo realmente se haya concedido (Google concede EXACTAMENTE lo que
// el consentimiento autorizó, sin importar qué pidió el código — ver el
// mismo control ya aplicado a Gmail en config/emailConfig.js). Un refresh
// token emitido ANTES de este cambio (bajo el scope anterior "drive.file")
// no incluye "drive" en sus scopes otorgados, así que esta verificación lo
// detecta solo y exige reconectar — nunca se asume que un token viejo sirve
// para el scope nuevo.
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
  if (creds.connectedEmail && info.email.toLowerCase() !== creds.connectedEmail.toLowerCase()) {
    const err = new Error(`El token autorizado pertenece a ${info.email}, no a ${creds.connectedEmail}.`);
    err.code = 'EOAUTH_EMAIL_MISMATCH';
    err.authorizedEmail = info.email;
    throw err;
  }
  const grantedScopes = info.scopes || [];
  if (!grantedScopes.includes(REQUIRED_DRIVE_SCOPE)) {
    const err = new Error(
      `Google autorizó la cuenta ${info.email} pero sin el permiso completo de Google Drive (scope "drive"). Esto pasa si la cuenta autorizó con una versión anterior de esta app (scope "drive.file"). Agrega el scope "https://www.googleapis.com/auth/drive" en Google Cloud Console → OAuth consent screen → Data access, y vuelve a pulsar "Conectar con Google" para reautorizar.`
    );
    err.code = 'EOAUTH_MISSING_SCOPE';
    err.grantedScopes = grantedScopes;
    throw err;
  }
  return { accessToken: token, authorizedEmail: info.email };
}

let driveClient = null;
let driveClientKeySignature = null;

// Único punto donde se arma el cliente autenticado de la Drive API v3 — el
// resto del sistema (driveStorageService) nunca construye uno por su cuenta.
async function getDriveClient() {
  const creds = await resolveCredentials();
  if (!creds) {
    throw new Error(
      'Google Drive no está configurado. Ve a Admin → Configuración → Google Drive y conecta la cuenta de Google (OAuth2).'
    );
  }

  const signature = `${creds.clientId}:${creds.connectedEmail}`;
  if (driveClient && driveClientKeySignature === signature) return driveClient;

  const auth = createOAuth2Client(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });

  driveClient = google.drive({ version: 'v3', auth });
  driveClientKeySignature = signature;
  return driveClient;
}

// Se llama al guardar una configuración nueva (Client ID/Secret o
// reconexión) para que el próximo getDriveClient() arme un cliente fresco
// en vez de reutilizar uno con credenciales ya obsoletas.
function invalidateDriveClientCache() {
  driveClient = null;
  driveClientKeySignature = null;
}

module.exports = {
  GOOGLE_DRIVE_SCOPES,
  REQUIRED_DRIVE_SCOPE,
  getDriveConfigRow,
  resolveCredentials,
  hasCredentials,
  resolveRootFolderId,
  isConfigured,
  buildGoogleAuthUrl,
  exchangeOAuthCode,
  getAuthorizedEmail,
  verifyOAuth2,
  getDriveClient,
  invalidateDriveClientCache,
};
