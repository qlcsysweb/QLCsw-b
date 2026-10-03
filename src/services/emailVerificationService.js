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
const fs = require('fs');
const path = require('path');
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

// Correo del código: en INGLÉS (idioma universal para todos los clientes),
// con el logo de QLC incrustado (CID, no depende de imágenes externas).
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'email', 'qlc-logo.png');
let logoBuffer = null;
function logoAttachment() {
  if (!logoBuffer) {
    try {
      logoBuffer = fs.readFileSync(LOGO_PATH);
    } catch {
      return null;
    }
  }
  return { filename: 'qlc-logo.png', content: logoBuffer, contentType: 'image/png', cid: 'qlc-logo', contentDisposition: 'inline' };
}

const SUBJECT = 'QLC — Your email verification code';
const textBody = (code) =>
  `Quantum Liquidity Capital (QLC)\n\nYour verification code is: ${code}\n\nEnter it on the registration screen to confirm your email address. The code expires in 15 minutes.\n\nIf you did not request this registration, you can safely ignore this message.\n\n— Quantum Liquidity Capital (QLC)\nSupport: soporte@qlctrade.net`;
const htmlBody = (code, withLogo) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#05070a;font-family:Arial,Helvetica,sans-serif;color:#f4f7fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070a;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0d131a;border:1px solid #1f2a35;border-radius:16px;padding:28px 24px;">
${withLogo ? '<tr><td align="center" style="padding-bottom:18px;"><img src="cid:qlc-logo" width="180" alt="Quantum Liquidity Capital" style="display:block;border:0;max-width:180px;height:auto;"></td></tr>' : ''}
<tr><td align="center" style="font-size:18px;font-weight:bold;padding-bottom:8px;">Verify your email</td></tr>
<tr><td align="center" style="font-size:14px;color:#9ca9b7;padding-bottom:20px;line-height:1.5;">Enter this code on the registration screen to confirm your email address.</td></tr>
<tr><td align="center" style="padding-bottom:20px;"><div style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:bold;color:#5bd4ff;background:#05070a;border:1px solid #0076b8;border-radius:12px;padding:14px 22px;">${code}</div></td></tr>
<tr><td align="center" style="font-size:13px;color:#9ca9b7;line-height:1.5;padding-bottom:16px;">The code expires in <strong style="color:#f4f7fb;">15 minutes</strong>.<br>If you did not request this registration, you can safely ignore this message.</td></tr>
<tr><td align="center" style="font-size:12px;color:#6f7c89;border-top:1px solid #1f2a35;padding-top:14px;">Quantum Liquidity Capital (QLC) · Support: soporte@qlctrade.net</td></tr>
</table></td></tr></table></body></html>`;

async function sendRegistrationCode(email) {
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
  const logo = logoAttachment();
  try {
    await sendMailUnified(creds, {
      to: String(email).trim(),
      subject: SUBJECT,
      text: textBody(code),
      html: htmlBody(code, Boolean(logo)),
      attachments: logo ? [logo] : [],
    });
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
