const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

const listAvailability = asyncHandler(async (req, res) => {
  const slots = await prisma.availabilitySlot.findMany({
    where: { isActive: true },
    orderBy: { dayOfWeek: 'asc' },
  });
  res.json({ ok: true, slots });
});

const listAppointments = asyncHandler(async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { clientId: req.clientProfile.id },
    orderBy: { requestedDate: 'desc' },
  });
  res.json({ ok: true, appointments });
});

// CORREGIR.xlsx CLIENTE 02 — la cita exige obligatoriamente el número de
// caso (SupportCase.caseNumber) generado previamente por el propio
// cliente; se valida que ese caso exista y pertenezca al cliente antes de
// crear la cita, para que el admin pueda revisarlo antes de autorizarla.
const createAppointmentSchema = z.object({
  caseNumber: z.coerce.number().int().positive('Debes indicar el número de caso generado previamente.'),
  requestedDate: z.string(),
  requestedTime: z.string(),
  notes: z.string().optional(),
});

const createAppointment = asyncHandler(async (req, res) => {
  const data = createAppointmentSchema.parse(req.body);

  const supportCase = await prisma.supportCase.findFirst({
    where: { caseNumber: data.caseNumber, clientId: req.clientProfile.id },
  });
  if (!supportCase) {
    throw ApiError.badRequest('El número de caso indicado no existe o no pertenece a tu cuenta.');
  }

  const appointment = await prisma.appointment.create({
    data: {
      clientId: req.clientProfile.id,
      supportCaseId: supportCase.id,
      requestedDate: new Date(data.requestedDate),
      requestedTime: data.requestedTime,
      notes: data.notes,
      status: 'PENDING',
    },
  });
  res.status(201).json({ ok: true, appointment });
});

module.exports = { listAvailability, listAppointments, createAppointment };
