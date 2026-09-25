const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { notifyAdmins, notifyClient } = require('../../utils/notify');
const { saveCaseFile, streamCaseFile, CASE_FILE_SELECT } = require('../../utils/supportCaseFiles');

// Cada caso incluye el indicador de mensajes NUEVOS (mensajes del equipo QLC
// que el cliente todavía no abrió) y su conteo de archivos.
const listSupportCases = asyncHandler(async (req, res) => {
  const cases = await prisma.supportCase.findMany({
    where: { clientId: req.clientProfile.id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { files: true, messages: true } },
      messages: {
        where: { readAt: null, sender: { role: 'ADMIN' } },
        select: { id: true },
      },
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

const createSupportCaseSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1),
});

const createSupportCase = asyncHandler(async (req, res) => {
  const data = createSupportCaseSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  const supportCase = await prisma.supportCase.create({
    data: { clientId: req.clientProfile.id, subject: data.subject, message: data.message, status: 'OPEN' },
  });

  // AUDITORÍA QLC PARTE 12 — un nuevo caso de soporte requiere atención
  // administrativa: se notifica a todos los administradores activos.
  await notifyAdmins({
    title: 'Nuevo caso de soporte',
    message: `${client.firstName} ${client.lastName} registró el caso #${supportCase.caseNumber}: "${data.subject}"`,
    type: 'info',
    templateKey: 'support_case_created',
    templateParams: { caseNumber: String(supportCase.caseNumber), clientName: `${client.firstName} ${client.lastName}`, caseId: supportCase.id },
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Tu caso ha sido creado con éxito',
    message: `Tu caso #${supportCase.caseNumber}: "${data.subject}" fue registrado. QLC lo revisará pronto.`,
    type: 'success',
    templateKey: 'case_created_self',
    templateParams: { caseNumber: String(supportCase.caseNumber) },
  });

  res.status(201).json({ ok: true, case: supportCase });
});

// AUDITORÍA QLC PARTE 7 — mensajería interna del caso: el cliente puede
// escribir aquí antes de que exista una cita, para dar seguimiento a su caso.
const listCaseMessages = asyncHandler(async (req, res) => {
  const supportCase = await prisma.supportCase.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');

  // Abrir la conversación marca como leídos los mensajes del equipo QLC.
  await prisma.supportCaseMessage.updateMany({
    where: { supportCaseId: supportCase.id, readAt: null, sender: { role: 'ADMIN' } },
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
  const supportCase = await prisma.supportCase.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');

  const message = await prisma.supportCaseMessage.create({
    data: { supportCaseId: supportCase.id, senderUserId: req.user.id, content },
  });

  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  await notifyAdmins({
    title: `Nuevo mensaje del cliente en el caso #${supportCase.caseNumber}`,
    message: `${client.firstName} ${client.lastName}: ${content}`,
    type: 'info',
    templateKey: 'support_case_message_admin',
    templateParams: { caseNumber: String(supportCase.caseNumber), clientName: `${client.firstName} ${client.lastName}`, caseId: supportCase.id },
  });

  res.status(201).json({ ok: true, message });
});

// ARCHIVOS DEL CASO — cualquier tipo, máx. 5 MB (límite real en backend).
async function findOwnCase(req) {
  const supportCase = await prisma.supportCase.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!supportCase) throw ApiError.notFound('Caso no encontrado');
  return supportCase;
}

const listCaseFiles = asyncHandler(async (req, res) => {
  const supportCase = await findOwnCase(req);
  const files = await prisma.supportCaseFile.findMany({
    where: { supportCaseId: supportCase.id },
    orderBy: { createdAt: 'desc' },
    select: CASE_FILE_SELECT,
  });
  res.json({ ok: true, files });
});

const uploadCaseFile = asyncHandler(async (req, res) => {
  const supportCase = await findOwnCase(req);
  const file = await saveCaseFile({ supportCase, uploadedByUserId: req.user.id, file: req.file });

  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  await notifyAdmins({
    title: `Nuevo archivo del cliente en el caso #${supportCase.caseNumber}`,
    message: `${client.firstName} ${client.lastName} adjuntó "${file.fileName}".`,
    type: 'info',
    templateKey: 'support_case_message_admin',
    templateParams: { caseNumber: String(supportCase.caseNumber), clientName: `${client.firstName} ${client.lastName}`, caseId: supportCase.id },
  });

  res.status(201).json({ ok: true, file: { id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt } });
});

const downloadCaseFile = asyncHandler(async (req, res) => {
  // Propiedad verificada por el caso (clientId del token), nunca solo por el id del archivo.
  const file = await prisma.supportCaseFile.findFirst({
    where: { id: req.params.fileId, supportCase: { id: req.params.id, clientId: req.clientProfile.id } },
  });
  if (!file) throw ApiError.notFound('Archivo no encontrado');
  await streamCaseFile(res, file);
});

module.exports = {
  listSupportCases,
  createSupportCase,
  listCaseMessages,
  sendCaseMessage,
  listCaseFiles,
  uploadCaseFile,
  downloadCaseFile,
};
