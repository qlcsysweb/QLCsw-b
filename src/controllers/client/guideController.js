const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');
const { annotateGuide } = require('../../utils/systemGuides');

// El cliente solo ve guías activas dirigidas a CLIENT o BOTH — nunca las de
// audiencia ADMIN exclusiva. Las guías de sistema (p. ej. Permisos de API)
// viajan además con su clave estable y su PDF propio (ver utils/systemGuides).
const listGuides = asyncHandler(async (req, res) => {
  const guides = await prisma.guide.findMany({
    where: { isActive: true, audience: { in: ['CLIENT', 'BOTH'] } },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ ok: true, guides: guides.map(annotateGuide) });
});

module.exports = { listGuides };
