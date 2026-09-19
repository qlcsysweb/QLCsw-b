const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

function dateLabel(date) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date instanceof Date ? date : new Date(date)
  );
}

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
      // CORREGIR(2).xlsx ADMIN 27 — el admin debe poder ver el número de
      // caso y la cuenta/subcuenta asociados antes de autorizar/revisar la cita.
      supportCase: { select: { caseNumber: true, subject: true, status: true } },
      apiSubaccount: { select: { identifier: true, isPrincipal: true } },
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
    const date = dateLabel(appointment.requestedDate);
    const time = appointment.requestedTime;

    if (status === 'AUTORIZADA') {
      await notifyClient(appointment.clientId, {
        title: 'Tu cita fue confirmada',
        message: `Tu cita fue confirmada para el ${date} a las ${time}. ¡No lo olvides!`,
        type: 'success',
        templateKey: 'appointment_confirmed',
        templateParams: { date, time },
      });
    } else if (status === 'RECHAZADA') {
      await notifyClient(appointment.clientId, {
        title: 'Tu cita fue rechazada',
        message: 'Tu solicitud de cita fue rechazada.',
        type: 'warning',
        templateKey: 'appointment_rejected',
        templateParams: { date, time },
      });
    } else {
      await notifyClient(appointment.clientId, {
        title: 'Actualización de tu cita',
        message: `Tu solicitud de cita fue: ${status}`,
        type: 'info',
        templateKey: 'appointment_status_updated',
        templateParams: { status },
      });
    }
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
