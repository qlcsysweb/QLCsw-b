import { beforeEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const tradingFile = (file) => path.join(here, '../../src/modules/trading', file);

process.env.NODE_ENV = 'test';
process.env.EDU_DATABASE_URL = 'postgresql://sin-conexion:5432/edu';
process.env.EDU_DIRECT_URL = 'postgresql://sin-conexion:5432/edu';
process.env.TRAD_DATABASE_URL = 'postgresql://sin-conexion:5432/trad';
process.env.TRAD_DB_DRIVER = 'native';
process.env.EDU_JWT_SECRET = 'edu-secret-de-prueba';
process.env.TRAD_JWT_SECRET = 'trad-secret-de-prueba';
process.env.TRAD_ALLOWED_ORIGINS = 'https://trad.test';
process.env.TRAD_TRUST_PROXY_HOPS = '1';

const EMAIL = 'cliente@test.qlc';
const OLD_HASH = '$2a$04$hashoriginalhashoriginalhashoriginalhashoriginalhashor';

// Base en memoria: solo lo que usa el flujo de restablecer contraseña.
let user;
let codes;
const fakePrisma = {
  user: {
    findFirst: async ({ where }) => (where.email.equals.toLowerCase() === user.email ? user : null),
    findUnique: async ({ where }) => (where.id === user.id ? user : null),
    update: async ({ data }) => Object.assign(user, data),
  },
  emailVerificationCode: {
    findFirst: async ({ where }) =>
      codes
        .filter((c) => c.email === where.email && c.purpose === where.purpose && (where.consumedAt !== null || c.consumedAt === null))
        .at(-1) || null,
    updateMany: async ({ where, data }) => {
      const rows = codes.filter((c) => (where.id ? c.id === where.id : c.email === where.email && c.purpose === where.purpose) && c.consumedAt === null);
      rows.forEach((c) => Object.assign(c, data));
      return { count: rows.length };
    },
    create: async ({ data }) => {
      const row = { id: `c${codes.length}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
      codes.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = codes.find((c) => c.id === where.id);
      if (data.attempts?.increment) row.attempts += data.attempts.increment;
      return row;
    },
    delete: async ({ where }) => {
      codes = codes.filter((c) => c.id !== where.id);
    },
  },
};

let outbox;
let failSend;
let hasCredentials;
const fakeEmailConfig = {
  resolveCredentials: async () => (hasCredentials ? { method: 'oauth2' } : null),
  sendMailUnified: async (_creds, mail) => {
    if (failSend) throw new Error('Puerto bloqueado');
    outbox.push(mail);
  },
};

const stub = (file, exports) => {
  const id = require.resolve(tradingFile(file));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

describe('Restablecer contraseña de trading con código por correo', () => {
  let app;
  // Una IP por prueba: cada una tiene su propio límite de solicitudes.
  let testNumber = 0;
  const post = (url, body) => request(app).post(`/trad/api/auth/password-reset/${url}`).set('X-Forwarded-For', `203.0.113.${testNumber}`).send(body);
  const sentCode = () => outbox.at(-1).text.match(/\b\d{6}\b/)[0];
  const expireCooldown = () => codes.forEach((c) => {
    c.createdAt = new Date(0);
  });

  before(async () => {
    stub('config/prisma.cjs', fakePrisma);
    stub('config/emailConfig.cjs', fakeEmailConfig);
    ({ default: app } = await import('../../src/app.js'));
  });

  beforeEach(() => {
    testNumber += 1;
    user = { id: 'u1', email: EMAIL, isActive: true, passwordHash: OLD_HASH, preferredLanguage: 'es' };
    codes = [];
    outbox = [];
    failSend = false;
    hasCredentials = true;
  });

  test('envía el código al correo y la contraseña cambia con él', async () => {
    assert.equal((await post('request', { email: EMAIL.toUpperCase() })).status, 200);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, EMAIL);
    assert.match(outbox[0].subject, /restablecer/i);

    const verified = await post('verify', { email: EMAIL, code: sentCode() });
    assert.equal(verified.status, 200);
    const done = await post('complete', { resetToken: verified.body.resetToken, newPassword: 'NuevaClave123!' });
    assert.equal(done.status, 200);
    assert.notEqual(user.passwordHash, OLD_HASH);
  });

  test('un correo que no existe recibe la misma respuesta y no envía nada', async () => {
    const ghost = await post('request', { email: 'nadie@test.qlc' });
    const real = await post('request', { email: EMAIL });
    assert.equal(ghost.status, 200);
    assert.deepEqual(ghost.body, real.body);
    assert.equal(outbox.length, 1);
  });

  test('una cuenta inactiva no recibe código', async () => {
    user.isActive = false;
    assert.equal((await post('request', { email: EMAIL })).status, 200);
    assert.equal(outbox.length, 0);
  });

  test('respeta la espera entre reenvíos', async () => {
    await post('request', { email: EMAIL });
    assert.equal((await post('request', { email: EMAIL })).status, 200);
    assert.equal(outbox.length, 1);
  });

  test('si el correo no sale lo avisa y permite reintentar sin esperar', async () => {
    failSend = true;
    assert.equal((await post('request', { email: EMAIL })).status, 503);
    assert.equal(codes.length, 0);
    failSend = false;
    assert.equal((await post('request', { email: EMAIL })).status, 200);
    assert.equal(outbox.length, 1);
  });

  test('sin correo configurado responde igual para cualquier cuenta', async () => {
    hasCredentials = false;
    assert.equal((await post('request', { email: EMAIL })).status, 503);
    assert.equal((await post('request', { email: 'nadie@test.qlc' })).status, 503);
  });

  test('un código equivocado no sirve y a los 5 intentos se invalida', async () => {
    await post('request', { email: EMAIL });
    const code = sentCode();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) assert.equal((await post('verify', { email: EMAIL, code: wrong })).status, 400);
    assert.equal((await post('verify', { email: EMAIL, code })).status, 400);
  });

  test('el código es de un solo uso y un código nuevo invalida el anterior', async () => {
    await post('request', { email: EMAIL });
    const first = sentCode();
    expireCooldown();
    await post('request', { email: EMAIL });
    const second = sentCode();
    if (first !== second) assert.equal((await post('verify', { email: EMAIL, code: first })).status, 400);
    assert.equal((await post('verify', { email: EMAIL, code: second })).status, 200);
    assert.equal((await post('verify', { email: EMAIL, code: second })).status, 400);
  });

  test('un código vencido no sirve', async () => {
    await post('request', { email: EMAIL });
    codes.at(-1).expiresAt = new Date(0);
    assert.equal((await post('verify', { email: EMAIL, code: sentCode() })).status, 400);
  });
});
