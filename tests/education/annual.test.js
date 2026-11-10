import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildAnnualReport } from '../../src/modules/education/domain/annual.js';
import { buildPeriodSummary } from '../../src/modules/education/domain/finance.js';
import { verifyWebhookSignature } from '../../src/modules/education/services/payments/mercadopago.client.js';

const RF = { code: 'RENTA_FIJA', name: 'Renta fija', sortOrder: 1 };
const month = (m, opening, initial, final, extra = {}) => ({
  period: { month: m, label: `M${m}` },
  ...buildPeriodSummary({
    opening,
    positions: [{ id: 'a', assetId: 'a', name: 'CETES', category: RF, initialCapital: initial, finalCapital: final }],
    movements: extra.movements || [],
    incomes: [{ category: 'SALARIO', amount: 1000 }],
    expenses: [{ category: 'OTROS', amount: 600 }],
    protection: [], debts: [],
  }),
});

test('Informe anual consolida meses cerrados y separa movimientos de rentabilidad', () => {
  const months = [
    month(1, 1000, 1000, 1010),
    month(2, 1010, 1110, 1120, { movements: [{ type: 'APORTACION', amount: 100 }] }),
  ];
  const r = buildAnnualReport(2026, months);
  assert.equal(r.patrimony.opening, 1000);
  assert.equal(r.patrimony.final, 1120);
  assert.equal(r.patrimony.variation, 120);
  assert.equal(r.patrimony.contributions, 100);
  assert.equal(r.patrimony.profitability, 20);
  assert.equal(r.patrimony.variation, r.patrimony.netMovement + r.patrimony.profitability);
  assert.equal(r.cashflow.savings, 800);
  assert.equal(r.complete, false);
  assert.equal(r.products[0].result, 20);
  assert.ok(r.observations.some((o) => o.includes('Informe parcial')));
  assert.equal(buildAnnualReport(2026, []), null);
});

test('La liquidez del informe anual suma la liquidez inicial del portafolio y la registrada después', () => {
  const LQ = { code: 'LIQUIDEZ', name: 'Liquidez', sortOrder: 5 };
  const summary = buildPeriodSummary({
    opening: 300000,
    positions: [{ id: 'l', assetId: 'l', name: 'Cuenta', category: LQ, initialCapital: 280000, finalCapital: 300000 }],
    movements: [], incomes: [], expenses: [], debts: [],
    protection: [{ type: 'LIQUIDEZ', amount: 20000 }],
  });
  const r = buildAnnualReport(2026, [{ period: { month: 11, label: 'Noviembre' }, ...summary }]);
  assert.equal(r.liquidity.start, 300000);
  assert.equal(r.liquidity.end, 320000);
  assert.equal(r.liquidity.change, 20000);
  assert.equal(r.monthly[0].liquidity, 320000);
  const liquidityRow = r.categories.find((c) => c.code === 'LIQUIDEZ');
  assert.equal(liquidityRow.result, 300000);
  assert.equal(liquidityRow.finalCapital, 300000);
});

test('Firma de webhook de Mercado Pago (x-signature)', () => {
  const secret = 'test-secret';
  const ts = '1700000000';
  const manifest = `id:123456;request-id:req-1;ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  assert.equal(verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '123456', secret }), true);
  assert.equal(verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-2', dataId: '123456', secret }), false);
  assert.equal(verifyWebhookSignature({ signature: undefined, requestId: 'req-1', dataId: '1', secret }), false);
});
