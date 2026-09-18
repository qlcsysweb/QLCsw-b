const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

const listSupportCases = asyncHandler(async (req, res) => {
  const { status, clientId } = req.query;
  const cases = await prisma.supportCase.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { firstName: true, lastName: true } } },
  });
  res.json({ ok: true, cases });
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
    templateParams: { caseNumber: String(supportCase.caseNumber) },
  });

  res.status(201).json({ ok: true, message });
});

module.exports = { listSupportCases, createSupportCase, updateSupportCase, listCaseMessages, sendCaseMessage };
