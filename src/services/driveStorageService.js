/*
 * SERVICIO CENTRALIZADO DE ALMACENAMIENTO EN GOOGLE DRIVE — punto único de
 * conexión, búsqueda/creación de carpetas y subida/descarga de archivos.
 * Ningún controlador debe construir su propio cliente de Drive ni duplicar
 * la lógica de "buscar o crear carpeta" — todos pasan por aquí.
 *
 * Estructura en Drive:
 *   <rootFolderId> (raíz "QLC", configurable en el panel)
 *   └── Clientes/
 *       └── <Nombre Apellido> - <usuario o ID interno>/
 *           ├── Documentos/
 *           ├── Pagos/
 *           ├── QR/
 *           ├── Estados de cuenta/
 *           └── Otros/
 *
 * Si Google Drive no está configurado/conectado (OAuth2), las funciones
 * lanzan un error explícito — nunca se simula una subida exitosa. Los
 * IDs de carpeta se cachean en ClientProfile para no buscarlas en cada
 * subida; si el caché no existe (cliente registrado antes de que Drive
 * estuviera conectado, o cache perdido), se buscan por nombre y, si
 * tampoco existen en Drive, se crean — nunca se depende únicamente de que
 * la carpeta se haya creado en el registro.
 */
const { Readable } = require('stream');
const { getDriveClient, isConfigured, resolveRootFolderId } = require('../config/googleDrive');
const prisma = require('../config/prisma');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const SUBFOLDER_NAMES = {
  documents: 'Documentos',
  payments: 'Pagos',
  qr: 'QR',
  statements: 'Estados de cuenta',
  other: 'Otros',
};

// Campo de ClientProfile donde se cachea cada subcarpeta — "other" no se
// cachea individualmente (se resuelve bajo demanda, uso poco frecuente).
const SUBFOLDER_CACHE_FIELD = {
  documents: 'driveDocumentsFolderId',
  payments: 'drivePaymentsFolderId',
  qr: 'driveQrFolderId',
  statements: 'driveStatementsFolderId',
};

function escapeForQuery(name) {
  return name.replace(/'/g, "\\'");
}

// Búsqueda por nombre dentro de un padre — nunca crea. Útil para el paso
// "3. Si no existe, buscar la carpeta en Google Drive" cuando el ID
// cacheado en NeonDB se perdió o nunca se guardó.
async function findFolderByName(drive, name, parentId) {
  const { data } = await drive.files.list({
    q: `name='${escapeForQuery(name)}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    // Sin efecto en "Mi unidad" (caso real de sistemaweb.qlc@gmail.com);
    // evita que una carpeta dentro de una unidad compartida quede invisible.
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function createFolder(drive, name, parentId) {
  const { data } = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return data.id;
}

async function getOrCreateFolderByName(drive, name, parentId) {
  const existing = await findFolderByName(drive, name, parentId);
  if (existing) return existing;
  return createFolder(drive, name, parentId);
}

// Nombre de carpeta seguro y legible: nombre visible + identificador único
// (el `username` interno de QLC si ya lo tiene asignado, o su ID de
// ClientProfile) — nunca solo el nombre visible, que puede repetirse entre
// clientes distintos.
function clientFolderName(client) {
  const safeId = client.username || client.id;
  return `${client.firstName} ${client.lastName} - ${safeId}`;
}

// Búsqueda de solo lectura de la carpeta del cliente (no crea nada) — usada
// para saber si ya existe en Drive antes de decidir crearla.
async function findClientFolder(client) {
  if (client.driveClientFolderId) return client.driveClientFolderId;
  if (!(await isConfigured())) return null;

  const drive = await getDriveClient();
  const rootId = await resolveRootFolderId();
  const clientesFolderId = await findFolderByName(drive, 'Clientes', rootId);
  if (!clientesFolderId) return null;
  return findFolderByName(drive, clientFolderName(client), clientesFolderId);
}

// NOMENCLATURA ÚNICA — cuando un admin asigna la nomenclatura de un cliente
// que YA tenía una carpeta creada (bajo el nombre provisional con su ID
// interno, por haber subido algo antes de tener nomenclatura), esta función
// la renombra en Drive en vez de crear una carpeta duplicada. Si el cliente
// todavía no tiene carpeta, no hace nada — se creará normalmente con el
// nombre correcto en su primer uso (ver getOrCreateClientFolder).
async function renameClientFolderIfNeeded(client) {
  if (!client.driveClientFolderId) return null;
  if (!(await isConfigured())) return null;

  const drive = await getDriveClient();
  const newName = clientFolderName(client);
  await drive.files.update({ fileId: client.driveClientFolderId, requestBody: { name: newName }, supportsAllDrives: true });
  return client.driveClientFolderId;
}

async function getOrCreateSubfolderInDrive(drive, clientFolderId, key) {
  const name = SUBFOLDER_NAMES[key];
  if (!name) throw new Error(`Subcarpeta desconocida: ${key}`);
  return getOrCreateFolderByName(drive, name, clientFolderId);
}

// Paso central de "carpeta faltante" (§ CARPETA FALTANTE): usa el ID
// cacheado si existe; si no, busca por nombre en Drive; si tampoco existe,
// la crea; y siempre guarda el resultado en NeonDB para la próxima subida.
// Idempotente y segura de llamar en cada subida.
async function getOrCreateClientFolder(client) {
  if (client.driveClientFolderId) return client.driveClientFolderId;

  const drive = await getDriveClient();
  const rootId = await resolveRootFolderId();
  if (!rootId) {
    throw new Error(
      'No hay una carpeta raíz de Google Drive configurada. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
  const clientesFolderId = await getOrCreateFolderByName(drive, 'Clientes', rootId);
  const clientFolderId = await getOrCreateFolderByName(drive, clientFolderName(client), clientesFolderId);

  await prisma.clientProfile.update({
    where: { id: client.id },
    data: { driveClientFolderId: clientFolderId, driveSyncStatus: 'SYNCED', driveSyncError: null },
  });

  return clientFolderId;
}

// Devuelve (creando si hace falta) la subcarpeta pedida ("documents",
// "payments", "qr", "statements" u "other"), cacheando su ID en NeonDB
// cuando el tipo lo permite. Es la función que deben usar todos los
// controladores en vez de duplicar la lógica de buscar/crear.
async function getOrCreateSubfolder(client, key) {
  const cacheField = SUBFOLDER_CACHE_FIELD[key];
  if (cacheField && client[cacheField]) return client[cacheField];

  const drive = await getDriveClient();
  const clientFolderId = await getOrCreateClientFolder(client);
  const subfolderId = await getOrCreateSubfolderInDrive(drive, clientFolderId, key);

  if (cacheField) {
    await prisma.clientProfile.update({ where: { id: client.id }, data: { [cacheField]: subfolderId } });
  }
  return subfolderId;
}

// Compatibilidad con los controladores existentes: devuelve las dos
// subcarpetas más usadas (Documentos/Pagos) de una sola vez, más la carpeta
// del cliente. QR y Estados de cuenta se resuelven con getOrCreateSubfolder
// cuando se necesitan (evita crearlas de más para clientes que nunca suben
// ese tipo de archivo).
async function ensureClientFolders(client) {
  const clientFolderId = await getOrCreateClientFolder(client);
  const documentsFolderId = await getOrCreateSubfolder(client, 'documents');
  const paymentsFolderId = await getOrCreateSubfolder(client, 'payments');
  return { clientFolderId, documentsFolderId, paymentsFolderId };
}

// Carpeta raíz para archivos GLOBALES de la plataforma (no ligados a un
// cliente específico) — ej. el QR de pago compartido, configurado una sola
// vez por el admin para todos los clientes.
async function ensurePlatformFolder() {
  const drive = await getDriveClient();
  const rootId = await resolveRootFolderId();
  if (!rootId) {
    throw new Error(
      'No hay una carpeta raíz de Google Drive configurada. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
  return getOrCreateFolderByName(drive, 'Plataforma', rootId);
}

// Subcarpeta "QR" dentro de la carpeta global de Plataforma — usada por el
// único QR compartido (el de la cuenta de pago), a diferencia del QR de
// wallet, que es propio de cada cliente (ver getOrCreateSubfolder).
async function ensurePlatformQrFolder() {
  const drive = await getDriveClient();
  const platformFolderId = await ensurePlatformFolder();
  return getOrCreateFolderByName(drive, SUBFOLDER_NAMES.qr, platformFolderId);
}

async function uploadFileToDrive(buffer, { folderId, fileName, mimeType }) {
  const drive = await getDriveClient();
  const { data } = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, mimeType, size',
    supportsAllDrives: true,
  });
  return data;
}

async function downloadFileFromDrive(fileId) {
  const drive = await getDriveClient();
  const { data: meta } = await drive.files.get({ fileId, fields: 'name, mimeType, size', supportsAllDrives: true });
  const { data: stream } = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  return { stream, fileName: meta.name, mimeType: meta.mimeType };
}

// Nunca se llama directamente con solo el fileId: el controlador debe haber
// verificado YA la propiedad del archivo (clientId del registro en NeonDB
// coincide con el cliente autenticado, o el usuario es ADMIN) y pasar
// `authorized: true` explícitamente. Es una barrera intencional contra
// borrados por error — la revisión de propiedad vive en el controlador,
// donde ya conoce el modelo (Document/Statement/PaymentReport/etc.).
async function deleteDriveFileOnlyWhenAuthorized(fileId, { authorized } = {}) {
  if (!authorized) {
    throw new Error('deleteDriveFileOnlyWhenAuthorized: falta confirmar autorización antes de eliminar.');
  }
  const drive = await getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

// Metadatos estándar para guardar en NeonDB junto al archivo — cada
// controlador decide en QUÉ tabla los guarda (Document para documentos de
// identidad, o los campos propios de Statement/PaymentReport/etc.), pero
// arma el objeto siempre con esta misma forma para no inventar nombres de
// campo distintos en cada lugar.
function saveDriveMetadata({ uploaded, folderId, clientId, category, mimeType, sizeBytes, status = 'ACTIVE' }) {
  return {
    driveFileId: uploaded.id,
    driveFolderId: folderId,
    fileName: uploaded.name,
    mimeType: mimeType || uploaded.mimeType,
    sizeBytes: sizeBytes ?? Number(uploaded.size || 0),
    clientId,
    category,
    status,
    createdAt: new Date(),
  };
}

module.exports = {
  isConfigured,
  findClientFolder,
  getOrCreateClientFolder,
  renameClientFolderIfNeeded,
  getOrCreateSubfolder,
  ensureClientFolders,
  ensurePlatformFolder,
  ensurePlatformQrFolder,
  uploadFileToDrive,
  downloadFileFromDrive,
  deleteDriveFileOnlyWhenAuthorized,
  saveDriveMetadata,
  SUBFOLDER_NAMES,
};
