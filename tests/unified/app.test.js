import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { createRequire } from 'node:module';
import request from 'supertest';

const require = createRequire(import.meta.url);

process.env.NODE_ENV = 'test';
process.env.EDU_DATABASE_URL = 'postgresql://sin-conexion:5432/edu';
process.env.EDU_DIRECT_URL = 'postgresql://sin-conexion:5432/edu';
process.env.TRAD_DATABASE_URL = 'postgresql://sin-conexion:5432/trad';
process.env.TRAD_DB_DRIVER = 'native';
process.env.EDU_JWT_SECRET = 'edu-secret-de-prueba';
process.env.TRAD_JWT_SECRET = 'trad-secret-de-prueba';
process.env.EDU_FRONTEND_URL = 'https://edu.test';
process.env.TRAD_ALLOWED_ORIGINS = 'https://trad.test';
process.env.EDU_CLOUDINARY_CLOUD_NAME = 'nube-edu';
process.env.EDU_CLOUDINARY_API_KEY = 'llave-edu';
process.env.EDU_CLOUDINARY_API_SECRET = 'secreto-edu';
process.env.TRAD_CLOUDINARY_CLOUD_NAME = 'nube-trad';
process.env.TRAD_CLOUDINARY_API_KEY = 'llave-trad';
process.env.TRAD_CLOUDINARY_API_SECRET = 'secreto-trad';
process.env.TRAD_COOKIE_PATH = '/trad';
process.env.TRAD_COOKIE_SAMESITE = 'lax';

let app;

before(async () => {
  ({ default: app } = await import('../../src/app.js'));
});

describe('aplicación única', () => {
  test('una sola aplicación atiende salud general y ambas API', async () => {
    assert.equal((await request(app).get('/health')).status, 200);
    assert.ok((await request(app).get('/api/health')).body.time);
    assert.equal((await request(app).get('/trad/api/health')).body.service, 'qlc-trading');
  });

  test('cada módulo responde sus 404 sin invadir al otro', async () => {
    const edu = await request(app).get('/api/no-existe');
    const trad = await request(app).get('/trad/api/no-existe');
    assert.deepEqual(edu.body, { error: 'Ruta no encontrada' });
    assert.match(trad.body.message, /\/trad\/api\/no-existe/);
  });

  test('los middlewares quedan aislados por módulo', async () => {
    const edu = await request(app).get('/api/health');
    const trad = await request(app).get('/trad/api/health');
    assert.ok(edu.headers['content-security-policy'], 'helmet aplica en educación');
    assert.equal(trad.headers['content-security-policy'], undefined, 'helmet no aplica en trading');
    assert.equal(trad.headers['cache-control'], 'no-store, max-age=0');
    assert.notEqual(edu.headers['cache-control'], 'no-store, max-age=0');
  });

  test('cada módulo conserva su límite de cuerpo JSON', async () => {
    const body = JSON.stringify({ email: 'a'.repeat(300 * 1024), password: 'x' });
    const edu = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(body);
    const trad = await request(app).post('/trad/api/auth/login').set('Content-Type', 'application/json').send(body);
    assert.match(JSON.stringify(edu.body), /inesperado|too large|error/i, 'educación rechaza el cuerpo que excede 200 kb');
    assert.notEqual(edu.status, 400, 'educación no llega a validar el cuerpo');
    assert.equal(trad.status, 400, 'trading sí acepta 300 kb (límite 2 mb) y llega a validar');
  });

  test('CORS se resuelve por plataforma', async () => {
    const eduAllowed = await request(app).get('/api/health').set('Origin', 'https://edu.test');
    const eduDenied = await request(app).get('/api/health').set('Origin', 'https://trad.test');
    const tradAllowed = await request(app).get('/trad/api/health').set('Origin', 'https://trad.test');
    const tradDenied = await request(app).get('/trad/api/health').set('Origin', 'https://edu.test');
    assert.equal(eduAllowed.headers['access-control-allow-origin'], 'https://edu.test');
    assert.equal(eduDenied.headers['access-control-allow-origin'], undefined);
    assert.equal(tradAllowed.headers['access-control-allow-credentials'], 'true');
    assert.equal(tradDenied.status, 403);
  });

  test('el webhook de educación conserva el cuerpo original', async () => {
    const res = await request(app).post('/api/webhooks/paypal').set('Content-Type', 'application/json').send('{"sin":"evento"}');
    assert.equal(res.status, 400);
  });
});

describe('aislamiento de autenticación', () => {
  test('un token de una plataforma no sirve en la otra', async () => {
    const jwt = require('jsonwebtoken');
    const eduToken = jwt.sign({ sub: 'x', role: 'ADMIN' }, process.env.EDU_JWT_SECRET);
    const tradToken = jwt.sign({ sub: 'x', role: 'ADMIN' }, process.env.TRAD_JWT_SECRET);
    assert.equal((await request(app).get('/trad/api/auth/me').set('Authorization', `Bearer ${eduToken}`)).status, 401);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tradToken}`)).status, 401);
  });

  test('la cookie de trading queda limitada a su ruta', () => {
    const { cookieOptions } = require('../../src/modules/trading/utils/token.cjs');
    const options = cookieOptions();
    assert.equal(options.path, '/trad');
    assert.equal(options.sameSite, 'lax');
    assert.equal(process.env.TRAD_COOKIE_NAME, 'trad_session');
  });
});

describe('Cloudinary con credenciales por plataforma', () => {
  const realRequest = https.request;
  let captured = [];

  before(() => {
    https.request = (options) => {
      captured.push(options);
      const stub = new (require('node:events').EventEmitter)();
      stub.write = () => true;
      stub.end = () => undefined;
      stub.setTimeout = () => undefined;
      stub.destroy = () => undefined;
      return stub;
    };
  });
  after(() => {
    https.request = realRequest;
  });

  const lastPath = () => captured.at(-1)?.path || '';
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  test('educación firma con su nube y trading con la suya, sin configuración global', async () => {
    const { v2: cloudinary } = require('cloudinary');
    const { uploadBuffer } = await import('../../src/modules/education/services/cloudinary.service.js');
    const trading = require('../../src/modules/trading/config/cloudinary.cjs');

    uploadBuffer(Buffer.from('a'), 'carpeta').catch(() => undefined);
    await settle();
    assert.match(lastPath(), /\/nube-edu\//);

    trading.uploadBuffer(Buffer.from('b'), { folder: 'x', resourceType: 'raw' }).catch(() => undefined);
    await settle();
    assert.match(lastPath(), /\/nube-trad\//);

    uploadBuffer(Buffer.from('c'), 'carpeta').catch(() => undefined);
    await settle();
    assert.match(lastPath(), /\/nube-edu\//);
    assert.equal(cloudinary.config().api_secret, undefined);
  });
});
