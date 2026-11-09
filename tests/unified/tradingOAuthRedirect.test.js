import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const tradingFile = (file) => path.join(here, '../../src/modules/trading', file);
const saved = process.env.TRAD_BACKEND_PUBLIC_URL;

const fakeRes = () => ({ body: null, json(data) { this.body = data; } });

describe('Dirección de retorno de Google en el panel de trading', () => {
  const controllers = [
    ['correo', 'controllers/emailConfigController.cjs', 'services/emailConfigService.cjs', '/api/email-config/oauth/callback'],
    ['Drive', 'controllers/driveConfigController.cjs', 'services/driveConfigService.cjs', '/api/drive-config/oauth/callback'],
  ];

  before(() => {
    const id = require.resolve(tradingFile('config/prisma.cjs'));
    require.cache[id] = { id, filename: id, loaded: true, exports: {} };
    for (const [, , service] of controllers) require(tradingFile(service)).getStatus = async () => ({});
  });

  afterEach(() => {
    process.env.TRAD_BACKEND_PUBLIC_URL = 'https://www.qlctrade.net/trad';
  });

  after(() => {
    if (saved === undefined) delete process.env.TRAD_BACKEND_PUBLIC_URL;
    else process.env.TRAD_BACKEND_PUBLIC_URL = saved;
  });

  const read = async (controller) => {
    const res = fakeRes();
    await require(tradingFile(controller)).getConfig({ user: { id: 'admin' } }, res, assert.ifError);
    return res.body.config.oauthRedirectUri;
  };

  for (const [name, controller, , callback] of controllers) {
    test(`${name}: muestra la dirección que arma el backend, no una estimada`, async () => {
      process.env.TRAD_BACKEND_PUBLIC_URL = 'https://www.qlctrade.net/trad/';
      assert.equal(await read(controller), `https://www.qlctrade.net/trad${callback}`);
    });

    test(`${name}: sin URL pública no inventa una dirección`, async () => {
      delete process.env.TRAD_BACKEND_PUBLIC_URL;
      assert.equal(await read(controller), null);
    });
  }
});
