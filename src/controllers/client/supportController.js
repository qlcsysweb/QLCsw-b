const { z } = require('zod');
const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');

const listSupportCases = asyncHandler(async (req, res) => {
  const cases = await prisma.supportCase.findMany({
    where: { clientId: req.clientProfile.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ ok: true, cases });
});

const createSupportCaseSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1),
});

const createSupportCase = asyncHandler(async (req, res) => {
  const data = createSupportCaseSchema.parse(req.body);
  const supportCase = await prisma.supportCase.create({
    data: { clientId: req.clientProfile.id, subject: data.subject, message: data.message, status: 'OPEN' },
  });
  res.status(201).json({ ok: true, case: supportCase });
});

module.exports = { listSupportCases, createSupportCase };
