const { z } = require('zod');
const prisma = require('../../config/prisma');
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

const createAppointmentSchema = z.object({
  requestedDate: z.string(),
  requestedTime: z.string(),
  notes: z.string().optional(),
});

const createAppointment = asyncHandler(async (req, res) => {
  const data = createAppointmentSchema.parse(req.body);
  const appointment = await prisma.appointment.create({
    data: {
      clientId: req.clientProfile.id,
      requestedDate: new Date(data.requestedDate),
      requestedTime: data.requestedTime,
      notes: data.notes,
      status: 'PENDING',
    },
  });
  res.status(201).json({ ok: true, appointment });
});

module.exports = { listAvailability, listAppointments, createAppointment };
