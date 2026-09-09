const { z } = require('zod');
const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');

// Se exponen ambos idiomas (value = español, valueEn = inglés); el frontend
// decide cuál mostrar según el idioma activo (nunca se envían los dos a la vez).
const listContentPublic = asyncHandler(async (req, res) => {
  const rows = await prisma.publicContent.findMany();
  const bySection = {};
  for (const row of rows) {
    bySection[row.section] = bySection[row.section] || {};
    bySection[row.section][row.key] = { value: row.value, valueEn: row.valueEn };
  }
  res.json({ ok: true, content: bySection });
});

const listContentAdmin = asyncHandler(async (req, res) => {
  const rows = await prisma.publicContent.findMany({ orderBy: [{ section: 'asc' }, { key: 'asc' }] });
  res.json({ ok: true, content: rows });
});

const upsertContentSchema = z.object({
  section: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
  valueEn: z.string().nullable().optional(),
});

const upsertContent = asyncHandler(async (req, res) => {
  const { section, key, value, valueEn } = upsertContentSchema.parse(req.body);

  const row = await prisma.publicContent.upsert({
    where: { section_key: { section, key } },
    update: { value, valueEn, updatedByUserId: req.user.id },
    create: { section, key, value, valueEn, updatedByUserId: req.user.id },
  });

  res.json({ ok: true, content: row });
});

const bulkUpsertContent = asyncHandler(async (req, res) => {
  const schema = z.object({
    items: z.array(upsertContentSchema).min(1),
  });
  const { items } = schema.parse(req.body);

  const results = await prisma.$transaction(
    items.map((item) =>
      prisma.publicContent.upsert({
        where: { section_key: { section: item.section, key: item.key } },
        update: { value: item.value, valueEn: item.valueEn, updatedByUserId: req.user.id },
        create: { ...item, updatedByUserId: req.user.id },
      })
    )
  );

  res.json({ ok: true, content: results });
});

// Multimedia pública: solo lo publicado, agrupado por ubicación y ordenado.
// Nunca expone publicId de Cloudinary ni IDs técnicos innecesarios.
const listMediaPublic = asyncHandler(async (req, res) => {
  const rows = await prisma.mediaAsset.findMany({
    where: { isPublished: true, NOT: { location: 'logo' } },
    orderBy: [{ location: 'asc' }, { order: 'asc' }],
    select: { id: true, type: true, url: true, location: true, order: true, isPrimary: true, title: true },
  });
  const byLocation = {};
  for (const row of rows) {
    byLocation[row.location] = byLocation[row.location] || [];
    byLocation[row.location].push(row);
  }
  res.json({ ok: true, media: byLocation });
});

// El logo activo (imagen o video) para Hero/Login/Nav/plataforma. Si no hay
// ninguno publicado como principal, el frontend usa su PNG estático por defecto.
const getActiveLogo = asyncHandler(async (req, res) => {
  const asset = await prisma.mediaAsset.findFirst({
    where: { location: 'logo', isPublished: true, isPrimary: true },
    select: { type: true, url: true },
  });
  res.json({ ok: true, asset: asset || null });
});

module.exports = {
  listContentPublic,
  listContentAdmin,
  upsertContent,
  bulkUpsertContent,
  listMediaPublic,
  getActiveLogo,
};
