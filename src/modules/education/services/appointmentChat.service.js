import { prisma } from '../config/prisma.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../utils/httpError.js';
import { detectEvidenceType, EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES } from '../utils/fileSignature.js';
import * as drive from './google/drive.js';
import { notifyUser } from './notification.service.js';

// Archivos de chats y consultas: imágenes o PDF de hasta 5 MB, guardados en la carpeta del cliente en Drive.
export const fileStorage = {
  connected: () => drive.driveConnected(),
  folder: (user, section) => drive.ensureClientFolder(user, section),
  upload: (meta) => drive.uploadBuffer(meta),
  remove: (id) => drive.deleteFile(id),
  stream: (id, range, res) => drive.streamFile(id, range, res),
};

export function prepareFiles(files) {
  const list = files || [];
  if (list.length > EVIDENCE_MAX_FILES) throw badRequest(`Puedes adjuntar como máximo ${EVIDENCE_MAX_FILES} archivos.`);
  return list.map((file) => {
    if (!file.size || !file.buffer?.length) throw badRequest(`El archivo "${file.originalname}" está vacío.`);
    if (file.size > EVIDENCE_MAX_BYTES) throw badRequest(`El archivo "${file.originalname}" pesa más de 5 MB.`);
    const mimeType = detectEvidenceType(file.buffer);
    if (!mimeType) throw badRequest(`El archivo "${file.originalname}" no es una imagen o PDF válido.`);
    return { buffer: file.buffer, size: file.size, mimeType, name: String(file.originalname || 'archivo').slice(0, 150) };
  });
}

// Sube los archivos a la carpeta del cliente; si alguno falla, borra los ya subidos.
export async function uploadFiles(owner, section, prefix, files) {
  if (!files.length) return [];
  if (!(await fileStorage.connected())) throw new HttpError(503, 'Por ahora no podemos recibir archivos. Intenta más tarde.');
  const parentId = await fileStorage.folder(owner, section);
  const uploaded = [];
  try {
    for (const file of files) {
      const result = await fileStorage.upload({ name: `${prefix}_${file.name}`.replace(/[\\/]+/g, '_').slice(0, 200), mimeType: file.mimeType, buffer: file.buffer, parentId });
      uploaded.push({ name: file.name, mimeType: file.mimeType, size: file.size, driveFileId: result.id });
    }
  } catch (err) {
    for (const u of uploaded) await fileStorage.remove(u.driveFileId).catch(() => null);
    console.error('[archivos] no se pudo subir:', err.message);
    throw new HttpError(502, 'No pudimos guardar tus archivos. Intenta de nuevo.');
  }
  return uploaded;
}

export async function streamStoredFile(driveFileId, name, range, res) {
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await fileStorage.stream(driveFileId, range, res);
}

const CHAT_SECTION = 'Citas';
const DEFAULT_MINUTES = 20;

// El chat se abre cuando la cita está confirmada. El contador corre desde la hora de la cita
// durante su duración; al terminar queda para consulta (sin enviar más mensajes).
export function chatWindow(appt, now = new Date()) {
  const startsAt = new Date(appt.scheduledAt);
  const minutes = appt.durationMin || DEFAULT_MINUTES;
  const endsAt = new Date(startsAt.getTime() + minutes * 60000);
  const confirmed = appt.status === 'CONFIRMED' || appt.status === 'COMPLETED';
  const phase = !confirmed ? 'NOT_CONFIRMED' : now < startsAt ? 'BEFORE' : now <= endsAt && appt.status === 'CONFIRMED' ? 'LIVE' : 'ENDED';
  return { startsAt, endsAt, minutes, phase, canSend: confirmed && phase !== 'ENDED', serverTime: now };
}

const messageView = (m) => ({
  id: m.id,
  senderRole: m.senderRole,
  senderName: m.senderName,
  body: m.body,
  file: m.driveFileId ? { id: m.id, name: m.fileName, mimeType: m.mimeType, size: m.size } : null,
  createdAt: m.createdAt,
});

const apptView = (a) => ({ id: a.id, reason: a.reason, scheduledAt: a.scheduledAt, durationMin: a.durationMin, channel: a.channel, status: a.status, user: a.user ? { id: a.user.id, name: a.user.name, email: a.user.email } : undefined });

async function loadAppointment(id) {
  const appt = await prisma.appointment.findUnique({ where: { id }, include: { user: true } });
  if (!appt) throw notFound('Cita no encontrada');
  return appt;
}

async function ownAppointment(userId, id) {
  const appt = await loadAppointment(id);
  if (appt.userId !== userId) throw notFound('Cita no encontrada');
  return appt;
}

// Si la migración del chat no está aplicada en la base, se explica en vez de fallar sin mensaje.
const missingTable = (err) => err?.code === 'P2021' || err?.code === 'P2022';
const CHAT_PENDING = 'El chat de citas todavía no está disponible: falta aplicar la actualización de la base de datos.';

async function chatPayload(appt) {
  const messages = await prisma.appointmentMessage.findMany({ where: { appointmentId: appt.id }, orderBy: { createdAt: 'asc' }, take: 500 }).catch((err) => {
    if (missingTable(err)) throw new HttpError(503, CHAT_PENDING);
    throw err;
  });
  return { appointment: apptView(appt), chat: chatWindow(appt), messages: messages.map(messageView) };
}

export const clientChat = async (userId, id) => chatPayload(await ownAppointment(userId, id));
export const adminChat = async (id) => chatPayload(await loadAppointment(id));

async function send(appt, sender, role, body, files) {
  const window = chatWindow(appt);
  if (window.phase === 'NOT_CONFIRMED') throw conflict('El chat se abre cuando la cita está confirmada.');
  if (!window.canSend) throw conflict('La cita ya terminó; el chat queda solo para consulta.');
  const text = String(body || '').trim().slice(0, 2000);
  const prepared = prepareFiles(files);
  if (!text && !prepared.length) throw badRequest('Escribe un mensaje o adjunta un archivo.');
  const uploaded = await uploadFiles(appt.user, CHAT_SECTION, `Cita_${appt.id.slice(-6)}`, prepared);
  const base = { appointmentId: appt.id, senderId: sender.id, senderRole: role, senderName: sender.name || sender.email };
  const created = [];
  if (text) created.push(await prisma.appointmentMessage.create({ data: { ...base, body: text } }));
  for (const u of uploaded) created.push(await prisma.appointmentMessage.create({ data: { ...base, fileName: u.name, mimeType: u.mimeType, size: u.size, driveFileId: u.driveFileId } }));
  const preview = text ? text.slice(0, 200) : `Archivo: ${uploaded.map((u) => u.name).join(', ')}`;
  if (role === 'CLIENT') {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    await Promise.all(admins.map((a) => notifyUser(a.id, { type: 'CITA_CHAT', title: `Mensaje de ${base.senderName} en su cita`, message: preview, link: `/admin/citas?chat=${appt.id}` })));
  } else {
    await notifyUser(appt.userId, { type: 'CITA_CHAT', title: 'Nuevo mensaje de tu asesor QLC', message: preview, link: `/app/asesoria?chat=${appt.id}` });
  }
  return created.map(messageView);
}

export async function clientSend(user, id, body, files) {
  return send(await ownAppointment(user.id, id), user, 'CLIENT', body, files);
}

export async function adminSend(admin, id, body, files) {
  return send(await loadAppointment(id), admin, 'ADMIN', body, files);
}

export async function streamChatFile(user, messageId, range, res) {
  const msg = await prisma.appointmentMessage.findUnique({ where: { id: messageId }, include: { appointment: { select: { userId: true } } } });
  if (!msg?.driveFileId || (user.role !== 'ADMIN' && msg.appointment.userId !== user.id)) throw notFound('Archivo no encontrado');
  await streamStoredFile(msg.driveFileId, msg.fileName, range, res);
}

// Próximas citas confirmadas (desde 30 minutos antes de ahora) para la barra del administrador.
export async function upcomingAppointments(admin, now = new Date()) {
  if (admin.role !== 'ADMIN') throw forbidden('Solo administradores');
  const rows = await prisma.appointment.findMany({
    where: { status: { in: ['PENDING', 'CONFIRMED'] }, scheduledAt: { gte: new Date(now.getTime() - 60 * 60000) } },
    include: { user: true },
    orderBy: { scheduledAt: 'asc' },
    take: 8,
  });
  return rows.map((a) => ({ ...apptView(a), chat: chatWindow(a, now) }));
}
