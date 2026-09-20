/*
 * Lógica de configuración administrable de Google Drive (Admin →
 * Configuración → Google Drive). Mismo patrón OAuth2 que
 * emailConfigService.js (Gmail): ninguna credencial se lee ni se escribe
 * desde aquí en texto completo — el Client Secret y el refresh token
 * siempre viajan cifrados.
 */
const jwt = require('jsonwebtoken');
const {
  getDriveConfigRow,
  resolveCredentials,
  buildGoogleAuthUrl,
  exchangeOAuthCode,
  getAuthorizedEmail,
  verifyOAuth2,
  invalidateDriveClientCache,
} = require('../config/googleDrive');
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

// CORRECCIÓN — el estado ya NO depende de que el admin haya pulsado
// "Probar conexión" (eso hace además una llamada real a Drive para revisar
// la carpeta raíz — algo que en esta fase todavía no se autoriza). Aquí se
// hace una verificación EN VIVO pero liviana, solo contra el propio OAuth2
// de Google (refrescar el token + tokeninfo) — nunca toca archivos ni
// carpetas de Drive — para que "CONECTADO" refleje la realidad apenas se
// completa la autorización, sin depender de un paso manual aparte.
//
// Los 4 estados posibles, en el orden en que se evalúan:
//   NOT_CONFIGURED       — falta Client ID/Secret.
//   PENDING_AUTHORIZATION — hay credenciales, pero no hay (o no hay forma de
//                           usar) un refresh token: nunca se autorizó, o la
//                           fila está deshabilitada.
//   AUTH_ERROR           — hay un refresh token guardado, pero la
//                           verificación en vivo falló (vencido, revocado,
//                           cuenta equivocada, o sin el scope drive.file).
//   CONNECTED            — la verificación en vivo confirmó todo lo anterior.
async function getStatus() {
  const row = await getDriveConfigRow();
  const hasGoogleOAuthClient = Boolean(row.googleOAuthClientId && row.googleOAuthClientSecretEncrypted);
  const hasRefreshToken = Boolean(row.googleOAuthRefreshTokenEncrypted);

  let connectionState;
  let connectionError = null;
  let verifiedEmail = null;

  if (!hasGoogleOAuthClient) {
    connectionState = 'NOT_CONFIGURED';
  } else {
    let creds = null;
    try {
      creds = await resolveCredentials();
    } catch (err) {
      logSafeError('status-decrypt', err);
      connectionState = 'AUTH_ERROR';
      connectionError = `${err.message} (posible cambio de la clave de cifrado ENCRYPTION_KEY del servidor desde que se guardó). Vuelve a guardar la credencial desde este panel.`;
    }
    if (!connectionState) {
      if (!creds) {
        connectionState = 'PENDING_AUTHORIZATION';
      } else {
        try {
          const result = await verifyOAuth2(creds);
          connectionState = 'CONNECTED';
          verifiedEmail = result.authorizedEmail;
        } catch (err) {
          logSafeError('status-verify', err);
          connectionState = 'AUTH_ERROR';
          connectionError = humanizeError(err) + safeDiagnostic(err);
        }
      }
    }
  }

  return {
    connectionState,
    connectionError,
    isConnected: connectionState === 'CONNECTED',
    isEnabled: row.isEnabled,
    hasCredentials: hasRefreshToken,
    hasGoogleOAuthClient,
    googleOAuthClientIdMasked: maskGeneric(row.googleOAuthClientId),
    // Se muestra el correo que quedó guardado como referencia (útil incluso
    // en AUTH_ERROR, para saber con qué cuenta reconectar) — pero
    // `connectionState` es SIEMPRE la única fuente real de si está
    // conectado; nunca se infiere "conectado" solo porque este campo tenga
    // un valor, evitando la cuenta "fantasma" enmascarada.
    oauthConnectedEmail: row.oauthConnectedEmail,
    oauthConnectedEmailMasked: maskEmail(row.oauthConnectedEmail),
    verifiedEmail,
    rootFolderId: row.rootFolderId,
    rootFolderName: row.rootFolderName,
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

async function updateConfig({ rootFolderId, rootFolderName, isEnabled, googleClientId, googleClientSecret }, userId) {
  const row = await getDriveConfigRow();

  // Cambiar el Client ID/Secret invalida cualquier refresh token guardado
  // (fue emitido para el par cliente ANTERIOR) — obliga a reconectar.
  const oauthClientChanged = Boolean((googleClientId && googleClientId.trim() !== row.googleOAuthClientId) || googleClientSecret);
  const credentialsChanged = Boolean(oauthClientChanged);

  const updated = await prisma.driveConfiguration.update({
    where: { id: row.id },
    data: {
      ...(rootFolderId !== undefined ? { rootFolderId: rootFolderId || null } : {}),
      ...(rootFolderName ? { rootFolderName } : {}),
      ...(isEnabled !== undefined ? { isEnabled } : {}),
      ...(googleClientId ? { googleOAuthClientId: googleClientId.trim() } : {}),
      ...(googleClientSecret ? { googleOAuthClientSecretEncrypted: encrypt(googleClientSecret.trim()) } : {}),
      ...(oauthClientChanged ? { googleOAuthRefreshTokenEncrypted: null, oauthConnectedEmail: null } : {}),
      ...(credentialsChanged ? { lastTestStatus: null, lastTestedAt: null, lastTestMessage: null } : {}),
      configuredByUserId: row.configuredByUserId || userId,
      updatedByUserId: userId,
    },
  });
  invalidateDriveClientCache();
  return updated;
}

async function disconnect(userId) {
  const row = await getDriveConfigRow();
  const updated = await prisma.driveConfiguration.update({
    where: { id: row.id },
    data: {
      isEnabled: false,
      configuredByUserId: null,
      updatedByUserId: userId,
      googleOAuthClientId: null,
      googleOAuthClientSecretEncrypted: null,
      googleOAuthRefreshTokenEncrypted: null,
      oauthConnectedEmail: null,
      lastTestStatus: null,
      lastTestedAt: null,
      lastTestMessage: null,
    },
  });
  invalidateDriveClientCache();
  return updated;
}

// Paso 1 del OAuth2: genera la URL de consentimiento de Google. Exige que
// ya se haya guardado el Client ID/Secret de la app OAuth2 (Google Cloud
// Console).
async function startOAuth(userId) {
  const row = await getDriveConfigRow();
  if (!row.googleOAuthClientId || !row.googleOAuthClientSecretEncrypted) {
    throw new OAuthConfigError(
      'Primero guarda el Client ID y el Client Secret de tu aplicación OAuth2 de Google Cloud, antes de pulsar "Conectar con Google".'
    );
  }

  const clientSecret = decryptOrThrow(row.googleOAuthClientSecretEncrypted, 'No se pudo descifrar el Client Secret guardado.');
  const state = jwt.sign({ purpose: 'drive-oauth', sub: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = buildGoogleAuthUrl({ clientId: row.googleOAuthClientId, clientSecret, state });
  return { url };
}

// Paso 2: Google redirige aquí con ?code=...&state=.... Confirma CON GOOGLE
// cuál correo autorizó realmente. A diferencia del correo (que exige que el
// autorizado coincida con un "gmailUser" pre-declarado), aquí CUALQUIER
// cuenta personal puede autorizar — QLC solo documenta que debe ser
// sistemaweb.qlc@gmail.com; el sistema guarda la que realmente autorice.
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
  if (payload.purpose !== 'drive-oauth' || !payload.sub) {
    throw new OAuthConfigError('El enlace de autorización no es válido para esta operación.');
  }
  const userId = payload.sub;

  const row = await getDriveConfigRow();
  if (!row.googleOAuthClientId || !row.googleOAuthClientSecretEncrypted) {
    throw new OAuthConfigError('La configuración de Drive cambió antes de completar la conexión. Vuelve a intentarlo desde el panel.');
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
      'Google no devolvió un refresh token. Esto pasa si esa cuenta ya había autorizado esta misma app antes sin revocarla. Entra a https://myaccount.google.com/permissions con la cuenta que quieras conectar, quita el acceso de esta aplicación, y vuelve a pulsar "Conectar con Google".'
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

  // Mismo control de scope que en Gmail: Google concede EXACTAMENTE lo que
  // el consentimiento autorizó, sin importar qué pidió el código.
  const grantedScopes = (tokens.scope || '').split(/\s+/).filter(Boolean);
  if (!grantedScopes.includes('https://www.googleapis.com/auth/drive.file')) {
    throw new OAuthConfigError(
      `Google autorizó ${authorizedEmail} pero SIN el permiso de archivos de Drive (drive.file). No se guardó nada. ` +
        'Agrega ese scope en Google Cloud Console → OAuth consent screen → Data access (Agregar o quitar permisos), guarda, y vuelve a pulsar "Conectar con Google".'
    );
  }

  await prisma.driveConfiguration.update({
    where: { id: row.id },
    data: {
      googleOAuthRefreshTokenEncrypted: encrypt(tokens.refresh_token),
      oauthConnectedEmail: authorizedEmail,
      isEnabled: true,
      lastTestStatus: null,
      lastTestedAt: null,
      lastTestMessage: null,
      configuredByUserId: row.configuredByUserId || userId,
      updatedByUserId: userId,
    },
  });
  invalidateDriveClientCache();

  return { email: authorizedEmail };
}

function decryptOrThrow(encrypted, humanMessage) {
  try {
    return decrypt(encrypted);
  } catch (err) {
    throw new OAuthConfigError(humanMessage);
  }
}

function extractOAuthErrorCode(err) {
  const raw = err?.response?.data?.error;
  if (!raw) return undefined;
  return typeof raw === 'string' ? raw : raw.status || raw.message || JSON.stringify(raw);
}

function logSafeError(stage, err) {
  console.error(`[drive-test:${stage}]`, {
    code: err?.code,
    oauthError: extractOAuthErrorCode(err),
    oauthErrorDescription: err?.response?.data?.error_description,
    authorizedEmail: err?.authorizedEmail,
    grantedScopes: err?.grantedScopes,
  });
}

function safeDiagnostic(err) {
  const parts = [];
  if (err?.code) parts.push(`código=${err.code}`);
  const oauthErrorCode = extractOAuthErrorCode(err);
  if (oauthErrorCode) parts.push(`oauth_error=${oauthErrorCode}`);
  if (err?.authorizedEmail) parts.push(`correo_autorizado=${err.authorizedEmail}`);
  if (err?.grantedScopes) parts.push(`scopes_otorgados=${err.grantedScopes.join(', ') || 'ninguno'}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function humanizeError(err) {
  if (err?.code === 'EOAUTH_EMAIL_MISMATCH') {
    return `El token de Google autorizado pertenece a ${err.authorizedEmail}, no a la cuenta configurada. Reconecta con "Conectar con Google" usando exactamente esa cuenta.`;
  }
  if (err?.code === 'EOAUTH_MISSING_SCOPE' || err?.code === 'EOAUTH_NO_TOKEN' || err?.code === 'EOAUTH_NO_EMAIL' || err?.code === 'EMISSING_BACKEND_URL') {
    return err.message;
  }
  if (err?.response?.data?.error?.status === 'PERMISSION_DENIED' || /insufficient (authentication )?scopes?/i.test(err?.message || '')) {
    return 'Google rechazó la operación: el token autorizado no tiene el permiso de archivos de Drive (drive.file). Agrega ese scope en Google Cloud Console → OAuth consent screen → Data access y vuelve a conectar.';
  }
  const oauthError = extractOAuthErrorCode(err);
  if (oauthError === 'invalid_grant') {
    return 'Google rechazó el refresh token guardado (fue revocado desde la cuenta de Google, expiró por inactividad prolongada, o cambió la contraseña de esa cuenta). Debes reconectar desde "Conectar con Google".';
  }
  if (oauthError) {
    return `Google rechazó la solicitud OAuth2 (${oauthError}${err.response?.data?.error_description ? ': ' + err.response.data.error_description : ''}).`;
  }
  return `No pudimos completar la operación con Google Drive. Detalle: ${err?.message ? String(err.message).slice(0, 300) : 'error desconocido'}.`;
}

// Prueba real: verifica el refresh token/scope y, si pasa, confirma que la
// carpeta raíz configurada existe y es accesible. NO crea ni sube ningún
// archivo de prueba.
async function testConnection() {
  const row = await getDriveConfigRow();

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
    return recordTestResult(row.id, 'ERROR', 'Falta conectar una cuenta de Google (OAuth2) antes de poder probar la conexión.');
  }

  try {
    await verifyOAuth2(creds);
  } catch (err) {
    logSafeError('verify', err);
    return recordTestResult(row.id, 'ERROR', humanizeError(err) + safeDiagnostic(err));
  }

  if (!row.rootFolderId) {
    return recordTestResult(row.id, 'ERROR', 'La cuenta de Google está conectada, pero falta definir la carpeta raíz de Drive (Folder ID).');
  }

  try {
    const { getDriveClient } = require('../config/googleDrive');
    const drive = await getDriveClient();
    const { data } = await drive.files.get({ fileId: row.rootFolderId, fields: 'id, name, mimeType' });
    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      return recordTestResult(row.id, 'ERROR', 'El ID configurado no corresponde a una carpeta de Google Drive.');
    }
    return recordTestResult(row.id, 'OK', `Conexión verificada con la cuenta ${creds.connectedEmail} y la carpeta "${data.name}".`);
  } catch (err) {
    logSafeError('root-folder', err);
    const code = err?.code || err?.response?.status;
    if (code === 404) {
      return recordTestResult(row.id, 'ERROR', 'No encontramos esa carpeta en Google Drive. Verifica el Folder ID (y que la carpeta exista en la cuenta conectada).');
    }
    return recordTestResult(row.id, 'ERROR', humanizeError(err) + safeDiagnostic(err));
  }
}

async function recordTestResult(configId, status, message) {
  await prisma.driveConfiguration.update({
    where: { id: configId },
    data: { lastTestedAt: new Date(), lastTestStatus: status, lastTestMessage: message },
  });
  return { ok: status === 'OK', message };
}

module.exports = {
  getStatus,
  updateConfig,
  disconnect,
  startOAuth,
  completeOAuth,
  testConnection,
  OAuthConfigError,
};
