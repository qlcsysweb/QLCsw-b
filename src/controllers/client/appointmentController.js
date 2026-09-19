const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { getAvailableSlotsForDate, assertSlotIsAvailable } = require('../../utils/appointmentSlots');
const { notifyAdmins, notifyClient } = require('../../utils/notify');

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
    where: { clientId: req.clientProfile.id },
    orderBy: { requestedDate: 'desc' },
    include: {
      apiSubaccount: { select: { id: true, identifier: true, isPrincipal: true } },
      supportCase: { select: { caseNumber: true } },
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
      notes: data.notes,
      status: 'PENDING',
    },
  });

  // AUDITORÍA QLC PARTE 8/12 — el admin debe enterarse en cuanto se crea
  // una solicitud de cita, no solo cuando la revisa manualmente.
  const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
  await notifyAdmins({
    title: 'Nueva solicitud de cita',
    message: `${client.firstName} ${client.lastName} solicitó una cita para el ${data.requestedDate} a las ${data.requestedTime} (caso #${data.caseNumber}).`,
    type: 'info',
    templateKey: 'appointment_requested',
    templateParams: { clientName: `${client.firstName} ${client.lastName}`, date: data.requestedDate, time: data.requestedTime },
  });

  await notifyClient(req.clientProfile.id, {
    title: 'Tu cita ha sido creada con éxito',
    message: `Tu solicitud de cita para el ${data.requestedDate} a las ${data.requestedTime} fue enviada y espera la respuesta de QLC.`,
    type: 'info',
    templateKey: 'appointment_requested_self',
    templateParams: { date: data.requestedDate, time: data.requestedTime },
  });

  res.status(201).json({ ok: true, appointment });
});

module.exports = { listAvailability, listAvailableSlots, listAppointments, createAppointment };
