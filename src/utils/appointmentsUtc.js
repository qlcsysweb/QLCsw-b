/*
 * CITAS EN UTC — conversión única de los datos antiguos (hora de México).
 *
 * Antes, la disponibilidad del admin y la hora de cada cita se guardaban en
 * hora de México (UTC-6 fijo). Ahora todo es UTC. Las filas antiguas tienen
 * timeZone = null; esta rutina corre al arrancar el backend y las pasa a UTC
 * UNA sola vez (cada fila se marca "UTC" en la misma actualización, así que
 * repetirla —o que corran dos instancias a la vez— no vuelve a convertirlas).
 *
 * Se hace al arrancar el código nuevo (y no en la migración SQL) para que el
 * backend anterior, mientras siga desplegado, nunca lea horas UTC como si
 * fueran de México.
 *
 *   - Citas: fecha/hora de México + 6 h → fecha/hora UTC (si pasa de
 *     medianoche, la fecha avanza un día).
 *   - Disponibilidad: a pedido de QLC el horario de citas queda de 16:00 a
 *     23:00 UTC (10:00–17:00 hora de México) en los días que ya estaban
 *     activos.
 */
const prisma = require('../config/prisma');

const MEXICO_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UTC_RANGE = { startTime: '16:00', endTime: '23:00' };

function toUtc(requestedDate, requestedTime) {
  const dateOnly = requestedDate.toISOString().slice(0, 10);
  const instant = new Date(new Date(`${dateOnly}T${requestedTime}:00Z`).getTime() + MEXICO_OFFSET_MS);
  const iso = instant.toISOString();
  const dayShift = iso.slice(0, 10) === dateOnly ? 0 : 1;
  return {
    requestedDate: new Date(requestedDate.getTime() + dayShift * DAY_MS),
    requestedTime: iso.slice(11, 16),
  };
}

async function migrateAppointmentsToUtc() {
  const legacy = await prisma.appointment.findMany({
    where: { timeZone: null },
    select: { id: true, requestedDate: true, requestedTime: true },
  });
  let converted = 0;
  for (const a of legacy) {
    const valid = /^\d{2}:\d{2}$/.test(a.requestedTime || '');
    const data = valid ? { ...toUtc(a.requestedDate, a.requestedTime), timeZone: 'UTC' } : { timeZone: 'UTC' };
    const { count } = await prisma.appointment.updateMany({ where: { id: a.id, timeZone: null }, data });
    converted += count;
  }

  const { count: ranges } = await prisma.availabilitySlot.updateMany({
    where: { timeZone: null },
    data: { ...UTC_RANGE, timeZone: 'UTC' },
  });

  if (converted || ranges) {
    console.log(`[citas UTC] ${converted} cita(s) y ${ranges} rango(s) de disponibilidad convertidos a UTC.`);
  }
  return { converted, ranges };
}

module.exports = { migrateAppointmentsToUtc, toUtc };
