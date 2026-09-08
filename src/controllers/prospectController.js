const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { sendProspectWelcomeEmail } = require('../services/emailService');

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

// Comparación real contra NeonDB: trae los emails de todos los usuarios
// registrados (normalizados) y los usa como fuente de verdad — nunca un
// array estático ni un mock. Insensible a mayúsculas/minúsculas y a
// espacios accidentales.
async function getRegisteredEmailSet() {
  const users = await prisma.user.findMany({ select: { email: true } });
  return new Set(users.map((u) => normalizeEmail(u.email)));
}

const listProspects = asyncHandler(async (req, res) => {
  const { status, registration } = req.query;
  const prospects = await prisma.prospect.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
  });

  const registeredEmails = await getRegisteredEmailSet();
  let withRegistration = prospects.map((p) => ({
    ...p,
    isRegistered: registeredEmails.has(normalizeEmail(p.email)),
  }));

  if (registration === 'registered') {
    withRegistration = withRegistration.filter((p) => p.isRegistered);
  } else if (registration === 'unregistered') {
    withRegistration = withRegistration.filter((p) => !p.isRegistered);
  }

  res.json({
    ok: true,
    prospects: withRegistration,
    counts: {
      total: prospects.length,
      registered: prospects.filter((p) => registeredEmails.has(normalizeEmail(p.email))).length,
      unregistered: prospects.filter((p) => !registeredEmails.has(normalizeEmail(p.email))).length,
    },
  });
});

// Reutilizable desde el dashboard — misma fuente de verdad, sin duplicar lógica.
async function countUnregisteredProspects() {
  const [prospects, registeredEmails] = await Promise.all([
    prisma.prospect.findMany({ select: { email: true } }),
    getRegisteredEmailSet(),
  ]);
  return prospects.filter((p) => !registeredEmails.has(normalizeEmail(p.email))).length;
}

const createProspectSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  message: z.string().optional(),
  source: z.string().optional(),
});

const createProspect = asyncHandler(async (req, res) => {
  const data = createProspectSchema.parse(req.body);

  const prospect = await prisma.prospect.create({
    data: { ...data, infoRequested: true },
  });

  const emailResult = await sendProspectWelcomeEmail(prospect).catch((err) => ({
    sent: false,
    reason: err.message,
  }));

  const updated = await prisma.prospect.update({
    where: { id: prospect.id },
    data: emailResult.sent ? { emailSentAt: new Date() } : {},
  });

  res.status(201).json({ ok: true, prospect: updated, email: emailResult });
});

const updateProspectStatusSchema = z.object({
  status: z.enum(['NUEVO', 'CONTACTADO', 'CONVERTIDO', 'DESCARTADO']),
});

const updateProspectStatus = asyncHandler(async (req, res) => {
  const { status } = updateProspectStatusSchema.parse(req.body);
  const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
  if (!prospect) throw ApiError.notFound('Prospecto no encontrado');

  const updated = await prisma.prospect.update({ where: { id: prospect.id }, data: { status } });
  res.json({ ok: true, prospect: updated });
});

module.exports = {
  listProspects,
  createProspect,
  updateProspectStatus,
  countUnregisteredProspects,
};
