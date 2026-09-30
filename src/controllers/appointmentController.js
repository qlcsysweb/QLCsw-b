const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyClient } = require('../utils/notify');

// requestedDate es una fecha-calendario UTC (medianoche UTC): se formatea
// tal cual, sin convertir de zona (convertirla a México la movía un día atrás).
function dateLabel(date) {
  const iso = (date instanceof Date ? date : new Date(date)).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
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
    // Rangos en UTC (ver utils/appointmentSlots.js).
    prisma.availabilitySlot.createMany({ data: slots.map((s) => ({ ...s, timeZone: 'UTC' })) }),
  ]);

  const updated = await prisma.availabilitySlot.findMany({ orderBy: { dayOfWeek: 'asc' } });
  res.json({ ok: true, slots: updated });
});

const listAppointments = asyncHandler(async (req, res) => {
  const { status, clientId } = req.query;
  const appointments = await prisma.appointment.findMany({
    where: {
      // Las citas que el admin borró de su lista no se muestran (se conservan).
      adminArchivedAt: null,
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
    },
    orderBy: { requestedDate: 'desc' },
    include: {
      client: { select: { firstName: true, lastName: true } },
      prospect: { select: { firstName: true, lastName: true, email: true } },
      // CORREGIR(2).xlsx ADMIN 27 — el admin debe poder ver el número de
      // caso y la cuenta/subcuenta asociados antes de autorizar/revisar la cita.
      supportCase: { select: { id: true, caseNumber: true, subject: true, status: true } },
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
      timeZone: 'UTC',
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
        message: `Tu cita fue confirmada para el ${date} a las ${time} UTC. ¡No lo olvides!`,
        type: 'success',
        templateKey: 'appointment_confirmed_utc',
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

// BORRAR CITA (admin) — la quita de la lista de citas del admin. No se
// elimina de la base: el cliente conserva su historial y el chat asociado
// queda archivado. Una solicitud PENDIENTE primero debe autorizarse o
// rechazarse (así el cliente siempre recibe respuesta).
const archiveAppointment = asyncHandler(async (req, res) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, adminArchivedAt: null } });
  if (!appointment) throw ApiError.notFound('Cita no encontrada');
  if (appointment.status === 'PENDING') {
    throw ApiError.conflict('Primero autoriza o rechaza la solicitud de cita antes de borrarla.');
  }
  await prisma.appointment.update({ where: { id: appointment.id }, data: { adminArchivedAt: new Date() } });
  res.json({ ok: true });
});

module.exports = {
  archiveAppointment,
  listAvailability,
  setAvailability,
  listAppointments,
  createAppointment,
  updateAppointmentStatus,
};
