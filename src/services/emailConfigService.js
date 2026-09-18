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
    isConnected: Boolean(hasCreds && row.isEnabled),
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

// Envía un correo de prueba a la propia cuenta de Gmail configurada, para
// comprobar que las credenciales funcionan sin involucrar a ningún cliente.
async function testConnection() {
  const row = await getEmailConfigRow();
  const { resolveCredentials } = require('../config/emailConfig');
  const creds = await resolveCredentials();

  if (!creds) {
    return recordTestResult(row.id, 'ERROR', 'Falta configurar el correo de Gmail y su contraseña de aplicación.');
  }

  try {
    const transport = createGmailTransport(creds);
    await transport.sendMail({
      from: creds.user,
      to: creds.user,
      subject: 'QLC — Prueba de conexión de correo',
      text: 'Esta es una prueba de conexión enviada desde el panel de administración de QLC. Si la recibiste, el envío automático de correos está funcionando correctamente.',
    });
    return recordTestResult(row.id, 'OK', 'Conexión correcta. Se envió un correo de prueba a la propia cuenta configurada.');
  } catch (err) {
    // Log seguro: solo código/comando/respuesta SMTP (nunca credenciales,
    // que ni siquiera forman parte de este objeto de error).
    console.error('[email-test] Falló el envío de prueba', {
      code: err?.code,
      responseCode: err?.responseCode,
      command: err?.command,
    });
    const message = humanizeError(err);
    return recordTestResult(row.id, 'ERROR', message);
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
    return 'Gmail rechazó las credenciales. Verifica que sea una contraseña de aplicación de 16 caracteres (no la contraseña normal de la cuenta), que la verificación en dos pasos esté activa, y que el correo configurado sea el dueño de esa contraseña de aplicación.';
  }
  if (['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'ENOTFOUND', 'EDNS'].includes(err?.code)) {
    return 'No pudimos conectar con los servidores de Gmail (smtp.gmail.com:465). Verifica la conexión a internet del servidor e intenta nuevamente.';
  }
  return 'No pudimos enviar el correo de prueba. Revisa la configuración e intenta nuevamente.';
}

module.exports = { getStatus, updateConfig, disconnect, testConnection, EmailConfigLockedError };
