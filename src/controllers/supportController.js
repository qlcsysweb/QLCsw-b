const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');
const { saveCaseFile, streamCaseFile, CASE_FILE_SELECT } = require('../utils/supportCaseFiles');

// Cada caso incluye el indicador de mensajes NUEVOS del cliente (los que
// ningún admin ha abierto todavía) y su conteo de archivos.
const listSupportCases = asyncHandler(async (req, res) => {
  const { status, clientId } = req.query;
  const cases = await prisma.supportCase.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      client: { select: { firstName: true, lastName: true } },
      _count: { select: { files: true, messages: true } },
      messages: { where: { readAt: null, sender: { role: 'CLIENT' } }, select: { id: true } },
    },
  });
  res.json({
    ok: true,
    cases: cases.map(({ messages, _count, ...c }) => ({
      ...c,
      unreadMessages: messages.length,
      hasUnread: messages.length > 0,
      messageCount: _count.messages,
      fileCount: _count.files,
    })),
  });
});

// ARCHIVO DE SOPORTE — busca un caso por su N.º (o por id, desde una
// notificación) aunque ya esté cerrado, con su mensajería (contadores) y
// TODOS los chats de sus citas (cada chat finalizado queda guardado).
const lookupSupportCase = asyncHandler(async (req, res) => {
  const caseNumber = Number.parseInt(String(req.query.caseNumber || '').replace(/^#/, ''), 10);
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!Number.isFinite(caseNumber) && !id) throw ApiError.badRequest('Indica el número de caso.');
  const found = await prisma.supportCase.findFirst({
    where: Number.isFinite(caseNumber) ? { caseNumber } : { id },
    include: {
      client: { select: { firstName: true, lastName: true } },
      _count: { select: { files: true, messages: true } },
      messages: { where: { readAt: null, sender: { role: 'CLIENT' } }, select: { id: true } },
    },
  });
  if (!found) throw ApiError.notFound('Caso no encontrado');
  const chatSessions = await prisma.chatSession.findMany({
    where: { appointment: { supportCaseId: found.id } },
    orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      client: { select: { firstName: true, lastName: true } },
      appointment: {
        select: { requestedDate: true, requestedTime: true, supportCase: { select: { caseNumber: true, subject: true } } },
      },
      _count: { select: { messages: true } },
    },
  });
  const { messages, _count, ...c } = found;
  res.json({
    ok: true,
    case: { ...c, unreadMessages: messages.length, hasUnread: messages.length > 0, messageCount: _count.messages, fileCount: _count.files },
    chatSessions,
  });
});

const createSupportCaseSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1),
});

const createSupportCase = asyncHandler(async (req, res) => {
  const data = createSupportCaseSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const supportCase = await prisma.supportCase.create({
    data: { clientId: client.id, subject: data.subject, message: data.message, status: 'OPEN' },
  });
  res.status(201).json({ ok: true, case: supportCase });
});

const updateSupportCaseSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']),
});

const updateSupportCase = asyncHandler(async (req, res) => {
  const { status } = updateSupportCaseSchema.parse(req.body);
  const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');

  const updated = await prisma.supportCase.update({
    where: { id: supportCase.id },
    data: { status, closedAt: status === 'CLOSED' ? new Date() : null },
  });
  res.json({ ok: true, case: updated });
});

// AUDITORÍA QLC PARTE 7 — mensajería interna del caso, previa e
// independiente de la cita/chat de 15 minutos. El admin escribe aquí para
// pedir información, aclarar dudas o resolver el caso antes de que exista
// una cita agendada.
const listCaseMessages = asyncHandler(async (req, res) => {
  const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');

  // Abrir la conversación marca como leídos los mensajes del cliente.
  await prisma.supportCaseMessage.updateMany({
    where: { supportCaseId: supportCase.id, readAt: null, sender: { role: 'CLIENT' } },
    data: { readAt: new Date() },
  });

  const messages = await prisma.supportCaseMessage.findMany({
    where: { supportCaseId: supportCase.id },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { role: true, adminProfile: { select: { firstName: true, lastName: true } } } } },
  });
  res.json({ ok: true, messages });
});

const sendCaseMessageSchema = z.object({ content: z.string().min(1).max(2000) });

const sendCaseMessage = asyncHandler(async (req, res) => {
  const { content } = sendCaseMessageSchema.parse(req.body);
  const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');

  const message = await prisma.supportCaseMessage.create({
    data: { supportCaseId: supportCase.id, senderUserId: req.user.id, content },
  });

  if (supportCase.status === 'OPEN') {
    await prisma.supportCase.update({ where: { id: supportCase.id }, data: { status: 'IN_PROGRESS' } });
  }

  await notifyClient(supportCase.clientId, {
    title: `Nuevo mensaje en tu caso #${supportCase.caseNumber}`,
    message: content,
    type: 'info',
    templateKey: 'support_case_message',
    templateParams: { caseNumber: String(supportCase.caseNumber), caseId: supportCase.id },
  });

  res.status(201).json({ ok: true, message });
});

// ARCHIVOS DEL CASO — cualquier tipo, máx. 5 MB (límite real en backend).
const listCaseFiles = asyncHandler(async (req, res) => {
  const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');
  const files = await prisma.supportCaseFile.findMany({
    where: { supportCaseId: supportCase.id },
    orderBy: { createdAt: 'desc' },
    select: CASE_FILE_SELECT,
  });
  res.json({ ok: true, files });
});

const uploadCaseFile = asyncHandler(async (req, res) => {
  const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');
  const file = await saveCaseFile({ supportCase, uploadedByUserId: req.user.id, file: req.file });

  await notifyClient(supportCase.clientId, {
    title: `Nuevo archivo en tu caso #${supportCase.caseNumber}`,
    message: `QLC adjuntó "${file.fileName}".`,
    type: 'info',
    templateKey: 'support_case_message',
    templateParams: { caseNumber: String(supportCase.caseNumber), caseId: supportCase.id },
  });

  res.status(201).json({ ok: true, file: { id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt } });
});

const downloadCaseFile = asyncHandler(async (req, res) => {
  const file = await prisma.supportCaseFile.findFirst({
    where: { id: req.params.fileId, supportCaseId: req.params.id },
  });
  if (!file) throw ApiError.notFound('Archivo no encontrado');
  await streamCaseFile(res, file);
});

module.exports = {
  lookupSupportCase,
  listSupportCases,
  createSupportCase,
  updateSupportCase,
  listCaseMessages,
  sendCaseMessage,
  listCaseFiles,
  uploadCaseFile,
  downloadCaseFile,
};
