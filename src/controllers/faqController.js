const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const listFaqPublic = asyncHandler(async (req, res) => {
  const faqs = await prisma.fAQ.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
  });
  res.json({ ok: true, faqs });
});

const listFaqAdmin = asyncHandler(async (req, res) => {
  const faqs = await prisma.fAQ.findMany({ orderBy: { displayOrder: 'asc' } });
  res.json({ ok: true, faqs });
});

const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  displayOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const createFaq = asyncHandler(async (req, res) => {
  const data = faqSchema.parse(req.body);
  const faq = await prisma.fAQ.create({ data });
  res.status(201).json({ ok: true, faq });
});

const updateFaq = asyncHandler(async (req, res) => {
  const data = faqSchema.partial().parse(req.body);
  const existing = await prisma.fAQ.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('FAQ no encontrada');
  const faq = await prisma.fAQ.update({ where: { id: req.params.id }, data });
  res.json({ ok: true, faq });
});

const deleteFaq = asyncHandler(async (req, res) => {
  const existing = await prisma.fAQ.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('FAQ no encontrada');
  await prisma.fAQ.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = { listFaqPublic, listFaqAdmin, createFaq, updateFaq, deleteFaq };
