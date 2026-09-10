const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');

// El cliente solo ve guías activas dirigidas a CLIENT o BOTH — nunca las de
// audiencia ADMIN exclusiva.
const listGuides = asyncHandler(async (req, res) => {
  const guides = await prisma.guide.findMany({
    where: { isActive: true, audience: { in: ['CLIENT', 'BOTH'] } },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ ok: true, guides });
});

module.exports = { listGuides };
