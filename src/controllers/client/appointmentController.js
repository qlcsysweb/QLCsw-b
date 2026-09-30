const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { getAvailableSlotsForDate, assertSlotIsAvailable, mexicoTimeLabel } = require('../../utils/appointmentSlots');
const { notifyAdmins, notifyClient } = require('../../utils/notify');
const { chatOpensAt } = require('../../utils/chatSessions');

const listAvailability = asyncHandler(async (req, res) => {
  const slots = await prisma.availabilitySlot.findMany({
    where: { isActive: true },
    orderBy: { dayOfWeek: 'asc' },
  });
  res.json({ ok: true, slots });
});

// CORRECCIÓN 16 (bloque de 20) — horarios reales de 15 en 15 minutos,
// respetando la disponibilidad del admin, la anticipación mínima de 1 hora
// y los horarios ya ocupados por otra cita activa.
const availableSlotsSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida') });

const listAvailableSlots = asyncHandler(async (req, res) => {
  const { date } = availableSlotsSchema.parse(req.query);
  const slots = await getAvailableSlotsForDate(date);
  res.json({ ok: true, slots });
});

const listAppointments = asyncHandler(async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    // Sin las citas que el cliente borró ni las de casos que borró.
    where: { clientId: req.clientProfile.id, clientHiddenAt: null, NOT: { supportCase: { is: { clientHiddenAt: { not: null } } } } },
    orderBy: { requestedDate: 'desc' },
    include: {
      apiSubaccount: { select: { id: true, isPrincipal: true, slotIndex: true } },
      supportCase: { select: { id: true, caseNumber: true, subject: true } },
    },
  });
  res.json({ ok: true, appointments });
});

// CORREGIR(2).xlsx CLIENTE 25/26 — la cita exige obligatoriamente el número
// de caso (SupportCase.caseNumber) generado previamente por el propio
// cliente Y la cuenta/subcuenta que se va a revisar; ambos se validan como
// pertenecientes al cliente antes de crear la cita, para que el admin pueda
// revisarlos antes de autorizarla.
const createAppointmentSchema = z.object({
  caseNumber: z.coerce.number().int().positive('Debes indicar el número de caso generado previamente.'),
  apiSubaccountId: z.string().min(1, 'Debes indicar la cuenta/subcuenta que se va a revisar.'),
  // Fecha y hora de la cita en UTC.
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  requestedTime: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  notes: z.string().optional(),
});

const createAppointment = asyncHandler(async (req, res) => {
  const data = createAppointmentSchema.parse(req.body);

  const supportCase = await prisma.supportCase.findFirst({
    where: { caseNumber: data.caseNumber, clientId: req.clientProfile.id, clientHiddenAt: null },
  });
  if (!supportCase) {
    throw ApiError.badRequest('El número de caso indicado no existe o no pertenece a tu cuenta.');
  }
  // Solo casos vigentes: un caso cerrado ya no admite nuevas citas.
  if (supportCase.status === 'CLOSED') {
    throw ApiError.badRequest('El caso indicado está cerrado y ya no admite nuevas citas.');
  }

  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: data.apiSubaccountId, clientId: req.clientProfile.id },
  });
  if (!subaccount) {
    throw ApiError.badRequest('La cuenta/subcuenta indicada no existe o no pertenece a tu cuenta.');
  }

  // CORRECCIÓN 16 — nunca confiar en la hora que envía el frontend: debe
  // seguir siendo un horario real disponible (dentro de la disponibilidad
  // del admin, con al menos 1 hora de anticipación, y libre) en este mismo
  // instante del servidor.
  const isAvailable = await assertSlotIsAvailable(data.requestedDate, data.requestedTime);
  if (!isAvailable) {
    throw ApiError.conflict(
      'Ese horario ya no está disponible (fue tomado, quedó fuera de la anticipación mínima de 1 hora, o no está dentro del horario de atención). Selecciona otro horario.'
    );
  }

  const appointment = await prisma.appointment.create({
    data: {
      clientId: req.clientProfile.id,
      supportCaseId: supportCase.id,
      apiSubaccountId: subaccount.id,
      requestedDate: new Date(data.requestedDate),
      requestedTime: data.requestedTime,
      timeZone: 'UTC',
      notes: data.notes,
      status: 'PENDING',
    },
  });

  // AUDITORÍA QLC PARTE 8/12 — el admin debe enterarse en cuanto se crea
  // una solicitud de cita. La cita es en UTC; al ADMIN se le avisa también
  // en hora de México (su hora local). Al cliente, solo en UTC.
  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  const [y, m, d] = data.requestedDate.split('-');
  const dateUtc = `${d}/${m}/${y}`;
  const mx = mexicoTimeLabel(data.requestedDate, data.requestedTime);
  await notifyAdmins({
    title: 'Nueva solicitud de cita',
    message: `${client.firstName} ${client.lastName} solicitó una cita para el ${mx.date} a las ${mx.time} hora de México (${dateUtc} ${data.requestedTime} UTC) (caso #${data.caseNumber}).`,
    type: 'info',
    templateKey: 'appointment_requested_utc',
    templateParams: {
      clientName: `${client.firstName} ${client.lastName}`,
      date: dateUtc,
      time: data.requestedTime,
      dateMx: mx.date,
      timeMx: mx.time,
      appointmentId: appointment.id,
    },
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Tu cita ha sido creada con éxito',
    message: `Tu solicitud de cita para el ${dateUtc} a las ${data.requestedTime} UTC fue enviada y espera la respuesta de QLC.`,
    type: 'info',
    templateKey: 'appointment_requested_self_utc',
    templateParams: { date: dateUtc, time: data.requestedTime },
  });

  res.status(201).json({ ok: true, appointment });
});

// BORRAR CITA (cliente) — la quita de "Mis citas"; QLC la conserva (y su
// chat). No se permite mientras esté pendiente de respuesta o por atender
// (autorizada cuya hora aún no llega, o con el chat en curso).
const hideAppointment = asyncHandler(async (req, res) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id, clientHiddenAt: null },
    include: { chatSession: { select: { status: true } } },
  });
  if (!appointment) throw ApiError.notFound('Cita no encontrada');
  const opensAt = chatOpensAt(appointment);
  const busy =
    appointment.status === 'PENDING' ||
    (appointment.status === 'AUTORIZADA' &&
      (appointment.chatSession?.status === 'ACTIVE' || (opensAt && opensAt.getTime() > Date.now())));
  if (busy) {
    throw ApiError.conflict('Esta cita está pendiente o por atender. Podrás borrarla cuando termine o sea rechazada.');
  }
  await prisma.appointment.update({ where: { id: appointment.id }, data: { clientHiddenAt: new Date() } });
  res.json({ ok: true });
});

module.exports = { listAvailability, listAvailableSlots, listAppointments, createAppointment, hideAppointment };
