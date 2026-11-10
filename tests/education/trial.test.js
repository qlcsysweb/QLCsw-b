import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTrial, canUseTool, moduleState, summarizeAccess, TRIAL_TOOLS, trialWindow } from '../../src/modules/education/domain/access.js';

const now = new Date('2026-11-10T12:00:00Z');
const client = (daysAgo) => ({ role: 'CLIENT', createdAt: new Date(now.getTime() - daysAgo * 86400000) });
const trialAccess = (user, grants = []) => applyTrial(summarizeAccess(grants, now), trialWindow(user, 30, now));

test('un cliente nuevo usa gratis las herramientas M1, M2, M7–M9 y M12 durante 30 días (M3 no)', () => {
  const access = trialAccess(client(3));
  assert.equal(access.mode, 'TRIAL');
  assert.equal(access.hasAny, true);
  assert.deepEqual(access.tools, TRIAL_TOOLS);
  assert.equal(access.full, null);
  assert.equal(access.trial.expiresAt.toISOString(), '2026-12-07T12:00:00.000Z');
  for (const n of [3, 4, 5, 6, 10, 11]) {
    assert.equal(canUseTool(access, n), false);
    assert.equal(moduleState(n, { access, completed: [1, 2, 7, 8, 9] }), 'LOCKED_ACCESS');
  }
  assert.equal(moduleState(12, { access, completed: [] }), 'AVAILABLE');
});

test('pasado el mes la prueba termina y el cliente queda sin acceso', () => {
  const access = trialAccess(client(31));
  assert.equal(access.mode, 'NONE');
  assert.equal(access.hasAny, false);
  assert.equal(access.trial, null);
});

test('la prueba no aplica a administradores ni cambia un acceso completo', () => {
  assert.equal(trialWindow({ role: 'ADMIN', createdAt: now }, 30, now), null);
  assert.equal(trialWindow(client(1), 0, now), null);
  const full = trialAccess(client(1), [{ active: true, accessType: 'FULL_ANNUAL', startsAt: now, expiresAt: new Date('2027-11-10') }]);
  assert.equal(full.mode, 'FULL');
  assert.equal(full.trial, null);
});

test('un módulo comprado se conserva junto con la prueba', () => {
  const access = trialAccess(client(2), [{ active: true, accessType: 'TOOL_ONLY', moduleNumber: 5, startsAt: now, expiresAt: new Date('2026-12-30') }]);
  assert.equal(access.mode, 'TOOLS');
  assert.deepEqual(access.tools, [1, 2, 5, 7, 8, 9, 12]);
  assert.equal(access.toolAccess.find((t) => t.moduleNumber === 5).trial, undefined);
  assert.equal(access.toolAccess.find((t) => t.moduleNumber === 1).trial, true);
});
