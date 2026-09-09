const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const getTrackRecordPublic = asyncHandler(async (req, res) => {
  const trackRecord = await prisma.trackRecord.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ ok: true, trackRecord });
});

const getTrackRecordAdmin = asyncHandler(async (req, res) => {
  const trackRecord = await prisma.trackRecord.findFirst({ orderBy: { updatedAt: 'desc' } });
  res.json({ ok: true, trackRecord });
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  titleEn: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  descriptionEn: z.string().nullable().optional(),
  platformName: z.string().min(1).optional(),
  profileLink: z.string().url().optional().or(z.literal('')),
  ranking: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

const updateTrackRecord = asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await prisma.trackRecord.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Track Record no encontrado');

  const trackRecord = await prisma.trackRecord.update({ where: { id: req.params.id }, data });
  res.json({ ok: true, trackRecord });
});

module.exports = { getTrackRecordPublic, getTrackRecordAdmin, updateTrackRecord };
