/*
 * Lógica de configuración administrable de correo (Admin → Configuración →
 * Correo). Mismo patrón que driveConfigService.js: la contraseña de
 * aplicación NUNCA se lee ni se escribe aquí en texto completo — solo se
 * referencia su presencia (enmascarada).
 */
const { getEmailConfigRow, hasCredentials, sanitizeAppPassword, createGmailTransport } = require('../config/emailConfig');
const prisma = require('../config/prisma');
const { encrypt } = require('../utils/crypto');

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return '••••••••';
  const visible = user.slice(0, 3);
  return `${visible}${'•'.repeat(Math.max(user.length - 3, 3))}@${domain}`;
}

async function getStatus() {
  const row = await getEmailConfigRow();
  const hasCreds = await hasCredentials();
  const effectiveUser = (row.gmailUser && row.gmailAppPasswordEncrypted) ? row.gmailUser : process.env.GMAIL_USER || null;

  return {
    // "Conectado" ya NO significa solo "hay credenciales guardadas": exige
    // que la ÚLTIMA prueba de conexión contra Gmail haya sido exitosa.
    // Mientras no se pruebe (o si la prueba falló), el estado real es
    // "desconectado", aunque haya una fila completa en la base de datos.
    isConnected: Boolean(hasCreds && row.isEnabled && row.lastTestStatus === 'OK'),
    isEnabled: row.isEnabled,
    hasCredentials: hasCreds,
    hasOwnCredentials: Boolean(row.gmailUser && row.gmailAppPasswordEncrypted),
    gmailUserMasked: maskEmail(effectiveUser),
    gmailSenderName: row.gmailSenderName || 'Quantum Liquidity Capital (QLC)',
    // AUDITORÍA QLC PARTE 16 — Gmail siempre usa este SMTP fijo (nodemailer
    // lo resuelve internamente vía service:"gmail"); se muestra aquí solo
    // como información transparente para el admin, no es editable porque
    // QLC únicamente admite Gmail.
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    usingBootstrapEnv: !(row.gmailUser && row.gmailAppPasswordEncrypted) && Boolean(process.env.GMAIL_USER),
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt,
    // Misma regla que Google Drive (CORRECCIÓN 24): solo quien configuró
    // puede editar o desconectar — el controlador recalcula con req.user.id.
    configuredByUserId: row.configuredByUserId,
    isLockedByAnother: false,
  };
}

class EmailConfigLockedError extends Error {}

async function updateConfig({ gmailUser, gmailSenderName, gmailAppPassword, isEnabled }, userId) {
  const row = await getEmailConfigRow();
  if (row.configuredByUserId && row.configuredByUserId !== userId) {
    throw new EmailConfigLockedError(
      'Esta configuración ya fue guardada por otro administrador. Solo esa cuenta puede editarla o desconectarla.'
    );
  }

  // Cambiar el usuario o la contraseña invalida cualquier resultado de
  // prueba anterior: un "OK" guardado con la credencial VIEJA no puede
  // seguir mostrando "Conectado" para una credencial nueva sin probar.
  const credentialsChanged = Boolean(gmailUser || gmailAppPassword);

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
      ...(credentialsChanged ? { lastTestStatus: null, lastTestedAt: null, lastTestMessage: null } : {}),
      configuredByUserId: row.configuredByUserId || userId,
      updatedByUserId: userId,
    },
  });
}

async function disconnect(userId) {
  const row = await getEmailConfigRow();
  if (row.configuredByUserId && row.configuredByUserId !== userId) {
    throw new EmailConfigLockedError('Solo el administrador que configuró el correo puede desconectarlo.');
  }
  return prisma.emailConfiguration.update({
    where: { id: row.id },
    data: {
      isEnabled: false,
      configuredByUserId: null,
      updatedByUserId: userId,
      gmailUser: null,
      gmailAppPasswordEncrypted: null,
    },
  });
}

// Log seguro: solo metadatos técnicos del error (código, código SMTP,
// comando, y el texto de respuesta que el PROPIO SERVIDOR de Gmail envía —
// nunca lo que el cliente mandó, así que nunca contiene la contraseña).
function logSafeError(stage, err) {
  console.error(`[email-test:${stage}]`, {
    code: err?.code,
    responseCode: err?.responseCode,
    command: err?.command,
    response: err?.response ? String(err.response).slice(0, 300) : undefined,
  });
}

// Fragmento técnico verificable que se agrega al mensaje mostrado en el
// panel — a pedido explícito, nunca se sustituye el error real por un
// texto genérico: el admin ve la causa humana Y el detalle crudo seguro.
function safeDiagnostic(err) {
  const parts = [];
  if (err?.code) parts.push(`código=${err.code}`);
  if (err?.responseCode) parts.push(`SMTP=${err.responseCode}`);
  if (err?.command) parts.push(`comando=${err.command}`);
  if (err?.response) parts.push(`respuesta de Gmail="${String(err.response).slice(0, 200)}"`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

// Prueba real: primero resuelve y descifra las credenciales ACTUALMENTE
// guardadas, luego transport.verify() (handshake + login SMTP sin enviar
// nada) y solo si eso pasa, envía un correo de prueba a la propia cuenta
// configurada (nunca a un cliente ni a otro administrador).
async function testConnection() {
  const row = await getEmailConfigRow();
  const { resolveCredentials } = require('../config/emailConfig');

  let creds;
  try {
    creds = await resolveCredentials();
  } catch (err) {
    logSafeError('decrypt', err);
    if (err.code === 'EDECRYPT') {
      return recordTestResult(
        row.id,
        'ERROR',
        'No se pudo descifrar la contraseña de aplicación guardada en la base de datos (posible cambio de la clave de cifrado ENCRYPTION_KEY del servidor desde que se guardó). Vuelve a escribir y guardar la contraseña de aplicación desde este panel.'
      );
    }
    throw err;
  }

  if (!creds) {
    return recordTestResult(row.id, 'ERROR', 'Falta configurar el correo de Gmail y su contraseña de aplicación.');
  }

  const sourceNote =
    creds.source === 'env'
      ? ' [usando GMAIL_USER/GMAIL_APP_PASSWORD del servidor (.env), no hay credenciales propias guardadas en el panel]'
      : ' [usando la credencial guardada en el panel]';

  const transport = createGmailTransport(creds);

  try {
    await transport.verify();
  } catch (err) {
    logSafeError('verify', err);
    return recordTestResult(row.id, 'ERROR', humanizeError(err) + safeDiagnostic(err) + sourceNote);
  }

  try {
    await transport.sendMail({
      from: creds.user,
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
  const responseCode = err?.responseCode;
  if (responseCode === 535 || err?.code === 'EAUTH') {
    return 'Gmail rechazó las credenciales (usuario o contraseña de aplicación incorrectos, revocados, o verificación en dos pasos desactivada).';
  }
  if (['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'ENOTFOUND', 'EDNS'].includes(err?.code)) {
    return 'No pudimos conectar con los servidores de Gmail (smtp.gmail.com:465) desde este servidor — problema de red, DNS o firewall saliente, no de credenciales.';
  }
  if (err?.code === 'ESOCKET' || /ssl|tls|certificate/i.test(err?.message || '')) {
    return 'Falló el cifrado SSL/TLS al conectar con smtp.gmail.com:465.';
  }
  // Nunca se sustituye por un texto genérico sin información: si no coincide
  // con un caso conocido, se muestra el mensaje real de Nodemailer/Node
  // (nunca incluye la contraseña, solo describe el fallo de red o protocolo).
  return `No pudimos enviar el correo de prueba. Detalle: ${err?.message ? String(err.message).slice(0, 300) : 'error desconocido'}.`;
}

module.exports = { getStatus, updateConfig, disconnect, testConnection, EmailConfigLockedError };
