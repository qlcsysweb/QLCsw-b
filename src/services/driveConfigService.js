/*
 * Lógica de configuración administrable de Google Drive (Admin → Configuración
 * → Google Drive). La credencial técnica (cuenta de servicio) NUNCA se lee ni
 * se escribe desde aquí en texto completo — solo se referencia su presencia.
 */
const {
  getDriveClient,
  getDriveConfigRow,
  hasServiceAccountCreds,
  serviceAccountEmail,
} = require('../config/googleDrive');
const prisma = require('../config/prisma');

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return '••••••••';
  const visible = user.slice(0, 3);
  return `${visible}${'•'.repeat(Math.max(user.length - 3, 3))}@${domain}`;
}

async function getStatus() {
  const row = await getDriveConfigRow();
  const hasCreds = hasServiceAccountCreds();
  const resolvedFolderId = row.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  const isConnected = Boolean(hasCreds && row.isEnabled && resolvedFolderId);

  return {
    isConnected,
    isEnabled: row.isEnabled,
    hasServiceAccountCreds: hasCreds,
    serviceAccountEmailMasked: maskEmail(serviceAccountEmail()),
    rootFolderId: resolvedFolderId,
    rootFolderName: row.rootFolderName,
    usingBootstrapFolder: !row.rootFolderId && Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID),
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt,
  };
}

async function updateConfig({ rootFolderId, rootFolderName, isEnabled }, userId) {
  const row = await getDriveConfigRow();
  const updated = await prisma.driveConfiguration.update({
    where: { id: row.id },
    data: {
      ...(rootFolderId !== undefined ? { rootFolderId: rootFolderId || null } : {}),
      ...(rootFolderName ? { rootFolderName } : {}),
      ...(isEnabled !== undefined ? { isEnabled } : {}),
      updatedByUserId: userId,
    },
  });
  return updated;
}

async function disconnect(userId) {
  const row = await getDriveConfigRow();
  return prisma.driveConfiguration.update({
    where: { id: row.id },
    data: { isEnabled: false, updatedByUserId: userId },
  });
}

// Verifica la conexión real contra Drive usando files.get con `capabilities`,
// sin crear ni borrar ningún archivo de prueba.
async function testConnection() {
  const row = await getDriveConfigRow();

  if (!hasServiceAccountCreds()) {
    return await recordTestResult(row.id, 'ERROR', 'Falta configurar la credencial técnica en el servidor.');
  }

  const folderId = row.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    return await recordTestResult(row.id, 'ERROR', 'No se ha definido una carpeta raíz de Google Drive.');
  }

  try {
    const drive = getDriveClient();
    const { data } = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType, capabilities',
      supportsAllDrives: true,
    });

    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      return await recordTestResult(row.id, 'ERROR', 'El ID configurado no corresponde a una carpeta de Google Drive.');
    }

    const capabilities = {
      canCreate: Boolean(data.capabilities?.canAddChildren),
      canUpload: Boolean(data.capabilities?.canAddChildren),
      canDownload: data.capabilities?.canDownload !== false,
      canDelete: Boolean(data.capabilities?.canDelete || data.capabilities?.canTrashChildren),
    };

    await recordTestResult(row.id, 'OK', `Conexión correcta con la carpeta "${data.name}".`);
    return { ok: true, folderName: data.name, capabilities };
  } catch (err) {
    const message = humanizeDriveError(err);
    await recordTestResult(row.id, 'ERROR', message);
    return { ok: false, message };
  }
}

async function recordTestResult(configId, status, message) {
  await prisma.driveConfiguration.update({
    where: { id: configId },
    data: { lastTestedAt: new Date(), lastTestStatus: status, lastTestMessage: message },
  });
  if (status === 'ERROR') return { ok: false, message };
  return { ok: true, message };
}

function humanizeDriveError(err) {
  const code = err?.code || err?.response?.status;
  if (code === 404) {
    return 'No encontramos esa carpeta en Google Drive. Verifica el Folder ID.';
  }
  if (code === 403) {
    return 'La cuenta de servicio de QLC no tiene permiso sobre esa carpeta. Comparte la carpeta con el email de la cuenta de servicio y dale rol de Editor.';
  }
  if (code === 401) {
    return 'Las credenciales de la cuenta de servicio no son válidas.';
  }
  return 'No pudimos conectar con Google Drive. Revisa la configuración o intenta nuevamente.';
}

module.exports = { getStatus, updateConfig, disconnect, testConnection };
