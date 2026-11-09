import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.EDU_TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Notificaciones y prueba gratis (integración)', () => {
  let app;
  let prisma;
  let env;
  const stamp = Date.now().toString(36);
  const tokens = {};

  const register = async (key) => {
    const email = `notif-${key}-${stamp}@test.qlc`;
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, residenceCountry: 'MX', legalVersion: '2026-10-18', name: `Cliente ${key}`, email, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).activated.body.token;
    return email;
  };
  const as = (key) => ({
    get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokens[key]}`),
    post: (p, body = {}) => request(app).post(p).set('Authorization', `Bearer ${tokens[key]}`).send(body),
  });

  before(async () => {
    process.env.EDU_DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    ({ env } = await import('../../src/modules/education/config/env.js'));
    env.freeTrialDays = 30;
    const { createApp } = await import('../../src/app.js');
    app = createApp();
    ({ prisma } = await import('../../src/modules/education/config/prisma.js'));
  });

  after(async () => {
    env.freeTrialDays = 0;
    await prisma?.$disconnect();
  });

  test('un cliente nuevo tiene la prueba gratis y una notificación que la explica', async () => {
    await register('a');
    const info = await as('a').get('/api/payments/access');
    assert.equal(info.status, 200);
    assert.equal(info.body.access.mode, 'TRIAL');
    assert.deepEqual(info.body.access.tools, [1, 2, 3, 7, 8, 9, 12]);
    assert.equal((await as('a').get('/api/academy/modules/1')).status, 200);
    assert.equal((await as('a').get('/api/academy/modules/10')).status, 403);
    const list = await as('a').get('/api/notifications');
    assert.equal(list.status, 200);
    assert.ok(list.body.notifications.some((n) => n.type === 'PRUEBA_GRATIS'));
    assert.ok(list.body.unread >= 1);
  });

  test('las notificaciones se marcan, se borran y nadie toca las de otra persona', async () => {
    await register('b');
    const mine = (await as('a').get('/api/notifications')).body.notifications;
    const theirs = (await as('b').get('/api/notifications')).body.notifications;
    assert.equal((await as('b').post('/api/notifications/delete', { ids: mine.map((n) => n.id) })).body.deleted, 0);
    assert.equal((await as('a').post('/api/notifications/read-all')).status, 200);
    assert.equal((await as('a').get('/api/notifications')).body.unread, 0);
    assert.equal((await as('a').post('/api/notifications/delete', { ids: [mine[0].id] })).body.deleted, 1);
    assert.equal((await as('a').post('/api/notifications/delete', { ids: [] })).status, 400);
    assert.ok((await as('b').post('/api/notifications/delete-all')).body.deleted >= theirs.length);
    assert.equal((await as('b').get('/api/notifications')).body.notifications.length, 0);
    assert.equal((await request(app).get('/api/notifications')).status, 401);
  });

  test('sin la prueba, al mes del registro el cliente queda sin acceso', async () => {
    const email = await register('c');
    await prisma.user.update({ where: { email }, data: { createdAt: new Date(Date.now() - 31 * 86400000) } });
    const info = await as('c').get('/api/payments/access');
    assert.equal(info.body.access.mode, 'NONE');
    assert.equal((await as('c').get('/api/academy/modules/1')).status, 403);
  });
});
