const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

const listAvailability = asyncHandler(async (req, res) => {
  const slots = await prisma.availabilitySlot.findMany({
    where: { isActive: true },
    orderBy: { dayOfWeek: 'asc' },
  });
  res.json({ ok: true, slots });
});

const setAvailabilitySchema = z.object({
  slots: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string(),
      endTime: z.string(),
      isActive: z.boolean().optional(),
    })
  ),
});

const setAvailability = asyncHandler(async (req, res) => {
  const { slots } = setAvailabilitySchema.parse(req.body);

  await prisma.$transaction([
    prisma.availabilitySlot.deleteMany({}),
    prisma.availabilitySlot.createMany({ data: slots }),
  ]);

  const updated = await prisma.availabilitySlot.findMany({ orderBy: { dayOfWeek: 'asc' } });
  res.json({ ok: true, slots: updated });
});

const listAppointments = asyncHandler(async (req, res) => {
  const { status, clientId } = req.query;
  const appointments = await prisma.appointment.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
    },
    orderBy: { requestedDate: 'desc' },
    include: {
      client: { select: { firstName: true, lastName: true } },
      prospect: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  res.json({ ok: true, appointments });
});

const createAppointmentSchema = z.object({
  clientId: z.string().optional(),
  prospectId: z.string().optional(),
  requestedDate: z.string(),
  requestedTime: z.string(),
  notes: z.string().optional(),
});

const createAppointment = asyncHandler(async (req, res) => {
  const data = createAppointmentSchema.parse(req.body);
  const appointment = await prisma.appointment.create({
    data: {
      clientId: data.clientId,
      prospectId: data.prospectId,
      requestedDate: new Date(data.requestedDate),
      requestedTime: data.requestedTime,
      notes: data.notes,
      status: 'PENDING',
    },
  });
  res.status(201).json({ ok: true, appointment });
});

const updateAppointmentStatusSchema = z.object({
  status: z.enum(['PENDING', 'AUTORIZADA', 'RECHAZADA', 'COMPLETADA', 'CANCELADA']),
});

const updateAppointmentStatus = asyncHandler(async (req, res) => {
  const { status } = updateAppointmentStatusSchema.parse(req.body);
  const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appointment) throw ApiError.notFound('Cita no encontrada');

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status, approvedByUserId: status === 'AUTORIZADA' ? req.user.id : appointment.approvedByUserId },
  });

  if (status === 'AUTORIZADA' && appointment.clientId) {
    const existingSession = await prisma.chatSession.findUnique({ where: { appointmentId: appointment.id } });
    if (!existingSession) {
      await prisma.chatSession.create({
        data: {
          appointmentId: appointment.id,
          clientId: appointment.clientId,
          status: 'SCHEDULED',
          durationMinutes: 15,
        },
      });
    }
  }

  if (appointment.clientId && ['AUTORIZADA', 'RECHAZADA', 'COMPLETADA', 'CANCELADA'].includes(status)) {
    await notifyClient(appointment.clientId, {
      title: 'Actualización de tu cita',
      message: `Tu solicitud de cita fue: ${status}`,
      type: status === 'AUTORIZADA' ? 'success' : status === 'RECHAZADA' ? 'warning' : 'info',
      templateKey: 'appointment_status_updated',
      templateParams: { status },
    });
  }

  res.json({ ok: true, appointment: updated });
});

module.exports = {
  listAvailability,
  setAvailability,
  listAppointments,
  createAppointment,
  updateAppointmentStatus,
};
