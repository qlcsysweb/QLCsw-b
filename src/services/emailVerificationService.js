/*
 * VERIFICACIÓN DE CORREO EN EL REGISTRO PÚBLICO — al registrarse, QLC envía
 * un código de 6 dígitos al correo escrito; la cuenta solo se crea si el
 * cliente lo confirma. Así un correo mal escrito (p. ej. "@gmai.com") nunca
 * termina como cuenta registrada.
 *
 * Seguridad: el código se genera con crypto.randomInt y en la BD solo se
 * guarda su HMAC-SHA256 (con JWT_SECRET como clave). Un solo uso, vence a
 * los 15 minutos, máximo 5 intentos, y 60 s de espera entre reenvíos.
 */
const crypto = require('crypto');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { resolveCredentials, sendMailUnified } = require('../config/emailConfig');

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const PURPOSE = 'REGISTER';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const hashCode = (email, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || 'qlc').update(`${normalizeEmail(email)}:${code}`).digest('hex');

const COPY = {
  es: {
    subject: 'QLC — Código de verificación de tu correo',
    text: (code) =>
      `Tu código de verificación de Quantum Liquidity Capital (QLC) es: ${code}\n\nEscríbelo en la pantalla de registro para confirmar tu correo. El código vence en 15 minutos.\n\nSi tú no solicitaste este registro, ignora este mensaje.\n\n— Quantum Liquidity Capital (QLC)`,
  },
  en: {
    subject: 'QLC — Your email verification code',
    text: (code) =>
      `Your Quantum Liquidity Capital (QLC) verification code is: ${code}\n\nEnter it on the registration screen to confirm your email. The code expires in 15 minutes.\n\nIf you did not request this registration, please ignore this message.\n\n— Quantum Liquidity Capital (QLC)`,
  },
};

async function sendRegistrationCode(email, language = 'es') {
  const normalized = normalizeEmail(email);
  const last = await prisma.emailVerificationCode.findFirst({
    where: { email: normalized, purpose: PURPOSE },
    orderBy: { createdAt: 'desc' },
  });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
    throw ApiError.badRequest(`Espera ${wait} segundos antes de solicitar otro código.`);
  }
  const creds = await resolveCredentials();
  if (!creds) {
    throw ApiError.serviceUnavailable('No pudimos enviar el código de verificación en este momento. Intenta más tarde o contacta a soporte@qlctrade.net.');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  // Un código nuevo invalida los anteriores de ese correo.
  await prisma.emailVerificationCode.updateMany({
    where: { email: normalized, purpose: PURPOSE, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const row = await prisma.emailVerificationCode.create({
    data: { email: normalized, purpose: PURPOSE, codeHash: hashCode(normalized, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  const copy = COPY[language === 'en' ? 'en' : 'es'];
  try {
    await sendMailUnified(creds, { to: String(email).trim(), subject: copy.subject, text: copy.text(code) });
  } catch {
    await prisma.emailVerificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } }).catch(() => {});
    throw ApiError.serviceUnavailable('No pudimos enviar el código a ese correo. Revisa que esté bien escrito e intenta de nuevo.');
  }
  return { expiresAt: row.expiresAt };
}

// Comprueba el código (fuera de la transacción, para que un intento fallido
// sí quede contado). Devuelve el ID del código válido para consumirlo dentro
// de la transacción del registro.
async function checkRegistrationCode(email, code) {
  const normalized = normalizeEmail(email);
  const row = await prisma.emailVerificationCode.findFirst({
    where: { email: normalized, purpose: PURPOSE, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt <= new Date()) {
    throw ApiError.badRequest('El código de verificación venció o no existe. Solicita un código nuevo.');
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw ApiError.badRequest('Demasiados intentos con este código. Solicita un código nuevo.');
  }
  const expected = Buffer.from(row.codeHash, 'hex');
  const received = Buffer.from(hashCode(normalized, String(code || '').trim()), 'hex');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    await prisma.emailVerificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw ApiError.badRequest('El código de verificación es incorrecto.');
  }
  return row.id;
}

// Consume el código dentro de la transacción del registro (un solo uso, aun
// con dos solicitudes simultáneas).
async function consumeRegistrationCode(tx, codeId) {
  const { count } = await tx.emailVerificationCode.updateMany({ where: { id: codeId, consumedAt: null }, data: { consumedAt: new Date() } });
  if (!count) throw ApiError.badRequest('El código de verificación ya fue utilizado. Solicita un código nuevo.');
}

module.exports = { sendRegistrationCode, checkRegistrationCode, consumeRegistrationCode, normalizeEmail };
