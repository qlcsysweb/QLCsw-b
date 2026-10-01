/*
 * CHAT DE CITAS — reglas compartidas por el lado cliente y el lado admin.
 *
 *  - Ventana de hora: el chat de una cita solo puede INICIARSE a partir de la
 *    hora agendada (UTC). Antes solo lo bloqueaba la pantalla del cliente; el
 *    servidor ahora lo exige a ambos lados (el admin tampoco puede adelantarlo).
 *  - Archivos: cada mensaje puede llevar un archivo (foto o documento, 10 MB). El
 *    binario va a Google Drive (carpeta "Otros" del cliente); NeonDB solo
 *    guarda la metadata. Nunca se expone el enlace de Drive: se sirve por la
 *    API autenticada.
 */
const prisma = require('../config/prisma');
const ApiError = require('./ApiError');
const driveStorage = require('../services/driveStorageService');
const { assertChatFile } = require('./fileSignature');
const { safeFileName } = require('./supportCaseFiles');
const { streamEvidenceFile } = require('./paymentEvidence');
const { appointmentInstant, mexicoTimeLabel } = require('./appointmentSlots');
const { MAX_MESSAGE_FILE_BYTES } = require('../middleware/upload');

// Datos de la cita que necesitan las pantallas del chat (hora de apertura y
// número de caso).
const CHAT_APPOINTMENT_SELECT = {
  select: {
    requestedDate: true,
    requestedTime: true,
    supportCase: { select: { caseNumber: true, subject: true } },
  },
};

// Nunca se envía el ID de Drive al navegador.
const CHAT_MESSAGE_OMIT = { driveFileId: true, driveFolderId: true };

function chatOpensAt(appointment) {
  if (!appointment?.requestedDate || !/^\d{2}:\d{2}$/.test(appointment.requestedTime || '')) return null;
  return appointmentInstant(appointment.requestedDate.toISOString().slice(0, 10), appointment.requestedTime);
}

async function assertChatWindowOpen(session) {
  if (!session.appointmentId) return;
  const appointment = await prisma.appointment.findUnique({
    where: { id: session.appointmentId },
    select: { requestedDate: true, requestedTime: true },
  });
  const opensAt = chatOpensAt(appointment);
  if (!opensAt || Date.now() >= opensAt.getTime()) return;
  const dateStr = appointment.requestedDate.toISOString().slice(0, 10);
  const mx = mexicoTimeLabel(dateStr, appointment.requestedTime);
  const [y, m, d] = dateStr.split('-');
  throw ApiError.badRequest(
    `El chat se habilita a la hora de la cita: ${d}/${m}/${y} ${appointment.requestedTime} UTC (${mx.date} ${mx.time} hora de México).`
  );
}

// Crea un mensaje con archivo en una sesión ACTIVA ya validada por el
// controlador (dueño, estado y tiempo).
async function createFileMessage(session, { file, caption, senderUserId }) {
  if (!file) throw ApiError.badRequest('Adjunta un archivo.');
  const mimeType = assertChatFile(file, { maxBytes: MAX_MESSAGE_FILE_BYTES, maxLabel: '10 MB' });
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con el almacenamiento de documentos para guardar los adjuntos.');
  }
  const client = await prisma.clientProfile.findUnique({ where: { id: session.clientId } });
  const fileName = safeFileName(file.originalname);
  let uploaded;
  let folderId;
  try {
    folderId = await driveStorage.getOrCreateSubfolder(client, 'other');
    uploaded = await driveStorage.uploadFileToDrive(file.buffer, { folderId, fileName, mimeType });
  } catch {
    throw ApiError.serviceUnavailable('No se pudieron guardar los archivos adjuntos. Intenta nuevamente.');
  }
  return prisma.chatMessage.create({
    data: {
      chatSessionId: session.id,
      senderUserId,
      content: String(caption || '').trim().slice(0, 2000),
      fileName,
      mimeType,
      sizeBytes: file.size,
      driveFileId: uploaded.id,
      driveFolderId: folderId,
    },
    omit: CHAT_MESSAGE_OMIT,
  });
}

// Sirve el archivo de un mensaje de ESA sesión (la sesión ya se validó).
async function streamChatFile(res, session, messageId) {
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, chatSessionId: session.id, driveFileId: { not: null } },
  });
  if (!message) throw ApiError.notFound('Archivo adjunto no encontrado');
  await streamEvidenceFile(res, message);
}

module.exports = {
  CHAT_APPOINTMENT_SELECT,
  CHAT_MESSAGE_OMIT,
  chatOpensAt,
  assertChatWindowOpen,
  createFileMessage,
  streamChatFile,
};
