/*
 * CANDADO DE AFILIACIÓN — un cliente que se registró con la liga de un
 * afiliador queda ligado a ÉL. Si después se da de baja (o lo eliminan) y
 * quiere volver a inscribirse, solo puede hacerlo con la liga ORIGINAL de su
 * afiliador, nunca con la de otro.
 *
 * Cada registro con afiliador deja un candado (AffiliateReferralLock) que NO
 * se borra al eliminar la cuenta. Un nuevo registro se reconoce como la misma
 * persona si coincide el CORREO o el NOMBRE COMPLETO (sin distinguir
 * mayúsculas, acentos ni espacios de más). Si coincide el correo manda ese
 * candado; si solo coincide el nombre, el de nombre.
 */
const prisma = require('../config/prisma');
const ApiError = require('./ApiError');

const LOCKED_OTHER_MESSAGE =
  'Ya estuviste inscrito en QLC con la liga de otro afiliador. Para volver a inscribirte debes usar la liga original de tu afiliador.';
const LOCKED_UNAVAILABLE_MESSAGE =
  'Ya estuviste inscrito en QLC con un afiliador cuya liga ya no está disponible. Comunícate con QLC para volver a inscribirte.';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function normalizeFullName(firstName, lastName) {
  return `${firstName || ''} ${lastName || ''}`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Guarda el candado de un cliente con afiliador (idempotente por cliente).
async function recordReferralLock(db, { clientId, email, firstName, lastName, referrerClientId, referrerCode, source }) {
  if (!referrerClientId) return null;
  const data = {
    email: String(email || '').trim(),
    emailNormalized: normalizeEmail(email),
    fullName: `${firstName || ''} ${lastName || ''}`.trim(),
    fullNameNormalized: normalizeFullName(firstName, lastName),
    referrerClientId,
    referrerCode: referrerCode || null,
    source: source || null,
  };
  return db.affiliateReferralLock.upsert({
    where: { referredClientId: clientId },
    create: { referredClientId: clientId, ...data },
    update: {},
  });
}

// Lanza 409 si la persona (por correo o nombre completo) ya estuvo inscrita
// con OTRO afiliador. `referrerClientId` es el afiliador de la liga que usa
// ahora. Sin nombre (primer paso del registro) solo se revisa el correo.
async function assertReferralAllowed(db, { email, firstName, lastName, referrerClientId }) {
  const emailNormalized = normalizeEmail(email);
  const fullNameNormalized = firstName || lastName ? normalizeFullName(firstName, lastName) : '';
  const or = [{ emailNormalized }];
  if (fullNameNormalized) or.push({ fullNameNormalized });
  const locks = await db.affiliateReferralLock.findMany({
    where: { OR: or },
    select: {
      emailNormalized: true,
      referrerClientId: true,
      referrer: { select: { affiliateEnabled: true, status: true, user: { select: { isActive: true } } } },
    },
  });
  if (!locks.length) return;
  const byEmail = locks.filter((l) => l.emailNormalized === emailNormalized);
  const relevant = byEmail.length ? byEmail : locks;
  if (relevant.some((l) => l.referrerClientId && l.referrerClientId === referrerClientId)) return;
  const originalAvailable = relevant.some(
    (l) => l.referrer && l.referrer.affiliateEnabled && l.referrer.status !== 'INACTIVE' && l.referrer.user?.isActive
  );
  throw ApiError.conflict(originalAvailable ? LOCKED_OTHER_MESSAGE : LOCKED_UNAVAILABLE_MESSAGE);
}

// Al arrancar: crea el candado de los clientes con afiliador que todavía no
// lo tienen (clientes registrados antes de existir el candado). Idempotente.
async function backfillReferralLocks() {
  const missing = await prisma.clientProfile.findMany({
    where: { referredByClientId: { not: null } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      referredByClientId: true,
      referralCodeUsed: true,
      referralSource: true,
      user: { select: { email: true } },
    },
  });
  if (!missing.length) return 0;
  const existing = new Set(
    (await prisma.affiliateReferralLock.findMany({
      where: { referredClientId: { in: missing.map((c) => c.id) } },
      select: { referredClientId: true },
    })).map((l) => l.referredClientId)
  );
  let created = 0;
  for (const c of missing.filter((m) => !existing.has(m.id))) {
    await recordReferralLock(prisma, {
      clientId: c.id,
      email: c.user.email,
      firstName: c.firstName,
      lastName: c.lastName,
      referrerClientId: c.referredByClientId,
      referrerCode: c.referralCodeUsed,
      source: c.referralSource || 'BACKFILL',
    });
    created += 1;
  }
  return created;
}

module.exports = {
  LOCKED_OTHER_MESSAGE,
  LOCKED_UNAVAILABLE_MESSAGE,
  normalizeEmail,
  normalizeFullName,
  recordReferralLock,
  assertReferralAllowed,
  backfillReferralLocks,
};
