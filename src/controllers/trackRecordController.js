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

// ROI 30D / Tasa de éxito: porcentaje opcional. '' o null = sin configurar
// (el sitio público muestra "—"). Se acepta "12.5", "+12.5", "12,5" o "12.5%".
const percentField = (min, max) =>
  z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const raw = String(v).trim().replace('%', '').replace(',', '.').replace(/^\+/, '');
      if (raw === '') return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Valor porcentual inválido (entre ${min} y ${max}).` });
        return z.NEVER;
      }
      return Math.round(n * 100) / 100;
    });

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  titleEn: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  descriptionEn: z.string().nullable().optional(),
  platformName: z.string().min(1).optional(),
  profileLink: z.string().url().optional().or(z.literal('')),
  ranking: z.string().min(1).optional(),
  roi30d: percentField(-100, 99999999),
  winRate: percentField(0, 100),
  maxDrawdown: percentField(0, 100),
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
