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

// CORREGIR.xlsx ADMIN 05 — los prospectos marcados DESCARTADO se eliminan
// solos 5 días después de marcarse (limpieza perezosa, mismo patrón que la
// limpieza de notificaciones a 34 días — ver client/notificationController.js).
// Nunca toca prospectos activos (NUEVO/CONTACTADO/CONVERTIDO).
const DISCARDED_TTL_DAYS = 5;

async function cleanupDiscardedProspects() {
  const cutoff = new Date(Date.now() - DISCARDED_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.prospect.deleteMany({ where: { status: 'DESCARTADO', updatedAt: { lt: cutoff } } });
}

const listProspects = asyncHandler(async (req, res) => {
  await cleanupDiscardedProspects();
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
  message: z.string().optional(),
  source: z.string().optional(),
  // Idioma que el visitante tenía seleccionado al enviar el formulario
  // (cookie qlc_language del frontend) — solo se usa para redactar el
  // correo de bienvenida en ese idioma; nunca se guarda como preferencia
  // permanente ni se asocia a ningún userId.
  language: z.enum(['es', 'en']).optional(),
});

const createProspect = asyncHandler(async (req, res) => {
  const { language, ...data } = createProspectSchema.parse(req.body);

  const prospect = await prisma.prospect.create({
    data: { ...data, infoRequested: true },
  });

  const emailResult = await sendProspectWelcomeEmail(prospect, language).catch((err) => ({
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

// CORREGIR.xlsx ADMIN 05 — opción manual de borrado (además de la limpieza
// automática a los 5 días). Permite borrar cualquier prospecto puntual sin
// esperar el plazo, a discreción del admin.
const deleteProspect = asyncHandler(async (req, res) => {
  const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
  if (!prospect) throw ApiError.notFound('Prospecto no encontrado');
  await prisma.prospect.delete({ where: { id: prospect.id } });
  res.json({ ok: true });
});

module.exports = {
  listProspects,
  createProspect,
  updateProspectStatus,
  deleteProspect,
  countUnregisteredProspects,
};
