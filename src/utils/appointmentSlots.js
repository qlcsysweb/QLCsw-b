/*
 * CORRECCIÓN 16 (bloque de 20) — generación dinámica de horarios de citas.
 *
 * Reglas de negocio:
 *   - Los horarios se generan en intervalos de 15 minutos dentro de los
 *     rangos de disponibilidad activos del admin (AvailabilitySlot).
 *   - Ninguna cita puede solicitarse con menos de 1 hora de anticipación.
 *   - Un horario ya ocupado por una cita PENDING/AUTORIZADA no vuelve a
 *     ofrecerse (RECHAZADA/CANCELADA sí liberan el horario).
 *
 * Zona horaria: TODO el cálculo se hace en America/Mexico_City (CDMX),
 * zona operativa de QLC. México abolió el horario de verano a nivel
 * nacional en 2022 — CDMX opera todo el año en UTC-6, por eso el offset
 * fijo "-06:00" es seguro aquí (no hay que calcular reglas de DST).
 */
const prisma = require('../config/prisma');

const SLOT_INTERVAL_MINUTES = 15;
const MIN_ADVANCE_MS = 60 * 60 * 1000; // 1 hora
const CDMX_FIXED_OFFSET = '-06:00';

// Combina una fecha "YYYY-MM-DD" y una hora "HH:MM" interpretadas como hora
// local de CDMX, devolviendo el instante UTC real correspondiente.
function cdmxDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00${CDMX_FIXED_OFFSET}`);
}

function dayOfWeekForDate(dateStr) {
  // Ancla a mediodía CDMX (18:00 UTC) para evitar cualquier ambigüedad de
  // día calendario cerca de la medianoche al leer getUTCDay().
  return new Date(`${dateStr}T12:00:00${CDMX_FIXED_OFFSET}`).getUTCDay();
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

// Devuelve los horarios disponibles reales para una fecha dada: dentro de
// la disponibilidad activa del admin, con al menos 1 hora de anticipación
// desde "ahora", y excluyendo los ya ocupados por otra cita activa.
async function getAvailableSlotsForDate(dateStr) {
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

  // OJO: `requestedDate` se guarda como `new Date("YYYY-MM-DD")`, que
  // siempre resuelve a medianoche UTC exacta de esa fecha — NO medianoche
  // CDMX. Por eso la comparación es una igualdad exacta contra ese mismo
  // instante, nunca un rango anclado a CDMX (ese desfase de 6 horas hacía
  // que esta consulta nunca encontrara las citas del día, dejando
  // "disponible" un horario que ya estaba tomado).
  const dateOnlyUtc = new Date(`${dateStr}T00:00:00.000Z`);
  const takenAppointments = await prisma.appointment.findMany({
    where: {
      requestedDate: dateOnlyUtc,
      status: { in: ['PENDING', 'AUTORIZADA'] },
    },
    select: { requestedTime: true },
  });
  const taken = new Set(takenAppointments.map((a) => a.requestedTime));

  const now = Date.now();
  const minInstant = now + MIN_ADVANCE_MS;

  return Array.from(allSlots)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
    .filter((t) => !taken.has(t))
    .filter((t) => cdmxDateTime(dateStr, t).getTime() >= minInstant);
}

// Validación server-side real (nunca confiar solo en el dropdown del
// frontend): la fecha/hora solicitada debe seguir figurando entre los
// horarios disponibles calculados en este mismo instante.
async function assertSlotIsAvailable(dateStr, timeStr) {
  const available = await getAvailableSlotsForDate(dateStr);
  return available.includes(timeStr);
}

module.exports = {
  SLOT_INTERVAL_MINUTES,
  MIN_ADVANCE_MS,
  cdmxDateTime,
  getAvailableSlotsForDate,
  assertSlotIsAvailable,
};
