/*
 * CORRECCIÓN 16 (bloque de 20) — generación dinámica de horarios de citas.
 *
 * Reglas de negocio:
 *   - Los horarios se generan en intervalos de 15 minutos dentro de los
 *     rangos de disponibilidad activos del admin (AvailabilitySlot).
 *   - Ninguna cita puede solicitarse con menos de 30 minutos de anticipación.
 *   - Un horario ya ocupado por una cita PENDING/AUTORIZADA, o PROPUESTO por
 *     el admin y aún sin respuesta del cliente, no vuelve a ofrecerse
 *     (RECHAZADA/CANCELADA y las propuestas no aceptadas sí lo liberan).
 *
 * Zona horaria: las citas se agendan y se muestran en UTC (a pedido de QLC).
 * La disponibilidad del admin (AvailabilitySlot) y la hora guardada en cada
 * cita (requestedDate + requestedTime) están en UTC. Solo los avisos al ADMIN
 * agregan la hora de México (mexicoTimeLabel): CDMX opera todo el año en
 * UTC-6 (sin horario de verano desde 2022), por eso el desfase fijo es seguro.
 */
const prisma = require('../config/prisma');

const SLOT_INTERVAL_MINUTES = 15;
const MIN_ADVANCE_MS = 30 * 60 * 1000; // 30 minutos (a pedido de QLC)
const MEXICO_OFFSET_MS = 6 * 60 * 60 * 1000; // CDMX = UTC-6

// Instante real de una cita: fecha "YYYY-MM-DD" + hora "HH:MM" en UTC.
function appointmentInstant(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00Z`);
}

function dayOfWeekForDate(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

// Fecha "DD/MM/YYYY" y hora "HH:MM" de México para una cita en UTC — para
// que el ADMIN reciba el aviso en su hora local.
function mexicoTimeLabel(dateStr, timeStr) {
  const iso = new Date(appointmentInstant(dateStr, timeStr).getTime() - MEXICO_OFFSET_MS).toISOString();
  return { date: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`, time: iso.slice(11, 16) };
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

// Genera todos los horarios "HH:MM" de 15 en 15 minutos dentro de un rango
// [startTime, endTime) — el último horario ofrecido es el que termina
// exactamente en endTime (nunca uno que se pase del rango).
function generateRangeSlots(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const slots = [];
  for (let t = start; t + SLOT_INTERVAL_MINUTES <= end; t += SLOT_INTERVAL_MINUTES) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

// Devuelve los horarios disponibles reales (UTC) para una fecha dada: dentro
// de la disponibilidad activa del admin, con al menos 30 minutos de
// anticipación desde "ahora", y excluyendo los ya ocupados por otra cita
// activa o por un horario propuesto pendiente. `excludeAppointmentId` ignora
// una cita concreta (la misma que se está reagendando).
async function getAvailableSlotsForDate(dateStr, { excludeAppointmentId } = {}) {
  const dayOfWeek = dayOfWeekForDate(dateStr);
  const ranges = await prisma.availabilitySlot.findMany({
    where: { dayOfWeek, isActive: true },
  });

  const allSlots = new Set();
  for (const range of ranges) {
    for (const t of generateRangeSlots(range.startTime, range.endTime)) {
      allSlots.add(t);
    }
  }

  if (allSlots.size === 0) return [];

  // `requestedDate` se guarda como `new Date("YYYY-MM-DD")` = medianoche UTC
  // exacta de esa fecha: la comparación es una igualdad exacta.
  const dateOnlyUtc = new Date(`${dateStr}T00:00:00.000Z`);
  const notSelf = excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {};
  const [takenAppointments, pendingProposals] = await Promise.all([
    prisma.appointment.findMany({
      where: { requestedDate: dateOnlyUtc, status: { in: ['PENDING', 'AUTORIZADA'] }, ...notSelf },
      select: { requestedTime: true },
    }),
    prisma.appointment.findMany({
      where: { proposedDate: dateOnlyUtc, proposalStatus: 'PENDING', ...notSelf },
      select: { proposedTime: true },
    }),
  ]);
  const taken = new Set([...takenAppointments.map((a) => a.requestedTime), ...pendingProposals.map((a) => a.proposedTime)]);

  const minInstant = Date.now() + MIN_ADVANCE_MS;

  return Array.from(allSlots)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
    .filter((t) => !taken.has(t))
    .filter((t) => appointmentInstant(dateStr, t).getTime() >= minInstant);
}

// Validación server-side real (nunca confiar solo en el dropdown del
// frontend): la fecha/hora solicitada debe seguir figurando entre los
// horarios disponibles calculados en este mismo instante.
async function assertSlotIsAvailable(dateStr, timeStr, options) {
  const available = await getAvailableSlotsForDate(dateStr, options);
  return available.includes(timeStr);
}

module.exports = {
  SLOT_INTERVAL_MINUTES,
  MIN_ADVANCE_MS,
  appointmentInstant,
  mexicoTimeLabel,
  getAvailableSlotsForDate,
  assertSlotIsAvailable,
};
