import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.EDU_TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const CLABE = '728969000018696764';

run('Transferencia interbancaria STP: datos, comprobante y aprobación manual', () => {
  let app;
  let prisma;
  let testEmail;
  const uid = `stp${Date.now().toString(36)}`;
  const tokens = {};
  const ids = {};
  const drive = new Map();

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      put: (url, body = {}) => auth(request(app).put(url)).send(body),
    };
  };

  const report = (who, url, { orderNumber, transferredAt = new Date(Date.now() - 3600000).toISOString() } = {}) => {
    let req = request(app).post(url).set('Authorization', `Bearer ${tokens[who]}`);
    if (orderNumber !== undefined) req = req.field('orderNumber', orderNumber);
    return req.field('transferredAt', transferredAt).attach('files', PNG, 'captura.png');
  };

  async function register(key, residenceCountry) {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, residenceCountry, legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = (await prisma.user.findUnique({ where: { email: `${key}-${uid}@test.qlc` } })).id;
  }

  const resetCaches = async () => {
    (await import('../../src/modules/education/services/payments/paymentSettings.service.js')).resetPaymentSettingsCache();
    (await import('../../src/modules/education/services/payments/bitgetSettings.service.js')).resetBitgetCache();
    (await import('../../src/modules/education/services/payments/stpSettings.service.js')).resetStpCache();
  };

  before(async () => {
    process.env.EDU_DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/app.js');
    app = createApp();
    ({ prisma } = await import('../../src/modules/education/config/prisma.js'));
    ({ testEmail } = await import('../../src/modules/education/services/email.service.js'));
    const { storage } = await import('../../src/modules/education/services/payments/bitgetReport.service.js');
    const { encryptSecret } = await import('../../src/modules/education/utils/crypto.js');
    Object.assign(storage, {
      connected: async () => true,
      folder: async (user) => `folder-${user.id}`,
      upload: async ({ name, mimeType, buffer }) => {
        const id = `drive-${drive.size + 1}-${uid}`;
        drive.set(id, { name, mimeType, buffer });
        return { id };
      },
      remove: async (id) => drive.delete(id),
    });
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'bitget', 'stp'] } } });
    await prisma.appSetting.create({ data: { key: 'mercadopago', value: { enabled: false, account: { siteId: 'MLM' }, rates: { USD: 18, USDT: 18 } } } });
    await resetCaches();
    await prisma.googleIntegration.upsert({ where: { service: 'DRIVE' }, create: { service: 'DRIVE', status: 'CONNECTED', scopes: 'https://www.googleapis.com/auth/drive.file', encryptedRefreshToken: encryptSecret('r') }, update: { status: 'CONNECTED', scopes: 'https://www.googleapis.com/auth/drive.file', encryptedRefreshToken: encryptSecret('r') } });
    for (const [key, level] of [['admin', 'FULL'], ['edit', 'EDIT']]) {
      const email = `${key}-${uid}@admin.qlc`;
      await prisma.user.create({ data: { email, name: `Admin ${key}`, role: 'ADMIN', adminLevel: level, passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
      const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
      tokens[key] = (await completeTwoFactor(app, login.body.challengeToken)).token;
    }
    await register('mx', 'MX');
    await register('us', 'US');
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 50, currency: 'USD', active: true, billingCycle: null } });
    testEmail.setReady(true);
  });

  after(async () => {
    testEmail.setReady(false);
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'bitget', 'stp'] } } });
    await prisma.googleIntegration.deleteMany({ where: { service: 'DRIVE' } });
    await resetCaches();
  });

  test('Viene lista con la CLABE y el número de OXXO; solo el administrador general la cambia', async () => {
    assert.equal((await api('edit').get('/api/admin/stp-settings')).status, 403);
    const start = await api('admin').get('/api/admin/stp-settings');
    assert.equal(start.body.clabe, CLABE);
    assert.equal(start.body.oxxoNumber, '2242175349081620');
    assert.equal(start.body.enabled, true);
    assert.equal(start.body.oxxoEnabled, true);
    assert.deepEqual(start.body.missing, []);
    assert.equal(start.body.reviewHours, 24);
    assert.equal((await api('admin').put('/api/admin/stp-settings', { clabe: '123' })).status, 400);
    assert.equal((await api('admin').put('/api/admin/stp-settings', { oxxoNumber: 'abc' })).status, 400);
  });

  test('El beneficiario es el nombre del cliente si el panel no define otro', async () => {
    const res = await api('mx').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'STP' });
    assert.equal(res.body.checkout.stp.beneficiary, 'Cliente mx');
    assert.equal((await api('admin').put('/api/admin/stp-settings', { beneficiary: 'QLC Beneficiario' })).status, 200);
  });

  test('México ve Cripto, OXXO, STP y tarjeta en ese orden; OXXO es depósito manual al número de QLC', async () => {
    const access = await api('mx').get('/api/payments/access');
    assert.deepEqual(access.body.providers.filter((p) => p !== 'BITGET'), ['OXXO_DEPOSITO', 'STP']);
    const res = await api('mx').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'OXXO_DEPOSITO' });
    assert.equal(res.status, 201);
    assert.equal(res.body.checkout.mode, 'OXXO_DEPOSITO');
    assert.equal(res.body.checkout.stp.oxxoNumber, '2242175349081620');
    assert.equal(res.body.attempt.chargedCurrency, 'MXN');
    const created = await report('mx', `/api/payments/attempts/${res.body.attempt.id}/bitget-report`, { orderNumber: '' });
    assert.equal(created.status, 201);
    assert.equal(created.body.provider, 'OXXO_DEPOSITO');
    assert.match(created.body.orderNumber, /^OXXO-/);
  });

  test('Se ofrece solo a quien reside en México y cobra en pesos con los datos de la CLABE', async () => {
    const mx = await api('mx').get('/api/payments/access');
    assert.ok(mx.body.providers.includes('STP'));
    assert.equal(mx.body.stp.clabe, CLABE);
    const us = await api('us').get('/api/payments/access');
    assert.ok(!us.body.providers.includes('STP'));
    assert.equal((await api('us').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'STP' })).status, 409);
    const res = await api('mx').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'STP' });
    assert.equal(res.status, 201);
    assert.equal(res.body.checkout.mode, 'STP');
    assert.equal(res.body.checkout.stp.clabe, CLABE);
    assert.equal(res.body.checkout.stp.beneficiary, 'QLC Beneficiario');
    assert.equal(res.body.checkout.stp.reference, 'Cliente mx');
    assert.equal(res.body.attempt.chargedAmount, 900);
    assert.equal(res.body.attempt.chargedCurrency, 'MXN');
  });

  test('El comprobante no exige clave de rastreo, avisa del plazo de 24 horas y al aprobarlo activa el acceso con correo', async () => {
    const { body } = await api('mx').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'STP' });
    testEmail.outbox.length = 0;
    const created = await report('mx', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: '' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.provider, 'STP');
    assert.match(created.body.orderNumber, /^STP-/);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(testEmail.outbox.some((m) => m.template === 'transferReported' && m.data.hours === 24 && m.data.method === undefined));
    const overview = await api('mx').get('/api/payments/bitget');
    assert.equal(overview.body.stp.clabe, CLABE);
    assert.equal((await api('edit').post(`/api/admin/bitget-reports/${created.body.id}/received`)).body.status, 'REVIEW');
    const confirmed = await api('admin').post(`/api/admin/bitget-reports/${created.body.id}/confirm`);
    assert.equal(confirmed.body.status, 'CONFIRMED');
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: body.attempt.id } })).status, 'APPROVED');
    assert.ok(await prisma.accessGrant.findFirst({ where: { paymentAttemptId: body.attempt.id, active: true } }));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(testEmail.outbox.some((m) => m.template === 'accessActivated' && m.to === `mx-${uid}@test.qlc`));
  });

  test('Una clave de rastreo escrita se guarda tal cual', async () => {
    const { body } = await api('mx').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'STP' });
    const created = await report('mx', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: `RASTREO${uid}`.slice(0, 30) });
    assert.equal(created.status, 201);
    assert.equal(created.body.orderNumber, `RASTREO${uid}`.slice(0, 30));
  });
});
