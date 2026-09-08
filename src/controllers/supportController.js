const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

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

module.exports = { listSupportCases, createSupportCase, updateSupportCase };
