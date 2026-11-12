import { round2, sum } from '../utils/money.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const pctChange = (from, to) => (from === 0 ? null : round2(((to - from) / Math.abs(from)) * 100));
// Igual que en Inicio: la categoría Liquidez del portafolio más la liquidez registrada en protección.
export function liquidityTotal(summary, { opening = false } = {}) {
  const category = summary.portfolio.categories.find((c) => c.code === 'LIQUIDEZ');
  return round2(Number((opening ? category?.initial : category?.final) || 0) + summary.protection.total);
}



export function buildAnnualReport(year, snapshots) {
  const months = [...snapshots].sort((a, b) => a.period.month - b.period.month);
  if (!months.length) return null;
  const first = months[0];
  const last = months[months.length - 1];

  const opening = first.patrimony.opening;
  const final = last.patrimony.final;
  const variation = round2(final - opening);
  const contributions = sum(months, (m) => m.patrimony.contributions);
  const withdrawals = sum(months, (m) => m.patrimony.withdrawals);
  const profitability = sum(months, (m) => m.patrimony.profitability);
  const income = sum(months, (m) => m.cashflow.income);
  const expenses = sum(months, (m) => m.cashflow.expenses);
  const savings = round2(income - expenses);

  const monthly = months.map((m) => ({
    month: m.period.month,
    label: m.period.label,
    opening: m.patrimony.opening,
    final: m.patrimony.final,
    contributions: m.patrimony.contributions,
    withdrawals: m.patrimony.withdrawals,
    profitability: m.patrimony.profitability,
    roi: m.portfolio.global.roi,
    income: m.cashflow.income,
    expenses: m.cashflow.expenses,
    savings: m.cashflow.savings,
    liquidity: liquidityTotal(m),
    debt: m.debts.totalBalance,
    netWorth: m.balanceSheet.netWorth,
  }));

  const catMap = new Map();
  for (const m of months) {
    for (const c of m.portfolio.categories) {
      const prev = catMap.get(c.code) || { code: c.code, name: c.name, result: 0 };
      prev.result = round2(prev.result + c.result);
      catMap.set(c.code, prev);
    }
  }
  // Liquidez: igual que "Evolución de liquidez" (portafolio + la registrada en protección). Su capital
  // al cierre es la liquidez total y su resultado acumulado es lo que se agregó desde el inicio del año.
  const liquidityEnd = liquidityTotal(last);
  const liquidityAdded = round2(liquidityEnd - Number(first.portfolio.categories.find((x) => x.code === 'LIQUIDEZ')?.initial || 0));
  const categories = [...catMap.values()].map((c) => {
    const lastCat = last.portfolio.categories.find((x) => x.code === c.code);
    if (c.code === 'LIQUIDEZ') return { ...c, result: liquidityAdded, finalCapital: liquidityEnd, share: lastCat?.share ?? 0 };
    return { ...c, finalCapital: lastCat?.final ?? 0, share: lastCat?.share ?? 0 };
  });

  const prodMap = new Map();
  for (const m of months) {
    for (const p of m.portfolio.products) {
      const prev = prodMap.get(p.assetId) || { assetId: p.assetId, name: p.name, categoryName: p.categoryName, result: 0 };
      prev.result = round2(prev.result + p.result);
      prev.finalCapital = p.final;
      prodMap.set(p.assetId, prev);
    }
  }
  // Liquidez: la registrada en protección no es un producto; se suma al principal producto de liquidez
  // para que "Resultados por inversión" cuadre con la fila Liquidez (capital y resultado acumulado).
  const liquidityProducts = [...prodMap.values()].filter((p) => last.portfolio.products.find((x) => x.assetId === p.assetId)?.categoryCode === 'LIQUIDEZ'
    || first.portfolio.products.find((x) => x.assetId === p.assetId)?.categoryCode === 'LIQUIDEZ');
  if (liquidityProducts.length) {
    const initialOf = (assetId) => Number(first.portfolio.products.find((x) => x.assetId === assetId)?.initial || 0);
    for (const p of liquidityProducts) p.result = round2((p.finalCapital || 0) - initialOf(p.assetId));
    const main = [...liquidityProducts].sort((a, b) => (b.finalCapital || 0) - (a.finalCapital || 0))[0];
    const assigned = liquidityProducts.reduce((acc, p) => acc + p.result, 0);
    main.result = round2(main.result + liquidityAdded - assigned);
    main.finalCapital = round2((main.finalCapital || 0) + Number(last.protection?.total || 0));
  }
  const products = [...prodMap.values()].sort((a, b) => b.result - a.result);

  const report = {
    year,
    complete: months.length === 12,
    monthsClosed: months.length,
    patrimony: {
      opening,
      final,
      variation,
      growth: pctChange(opening, final),
      contributions,
      withdrawals,
      netMovement: round2(contributions - withdrawals),
      profitability,
      profitabilityOnOpening: opening > 0 ? round2((profitability / opening) * 100) : null,
    },
    cashflow: { income, expenses, savings, savingsRate: income === 0 ? null : round2((savings / income) * 100) },
    debt: { start: first.debts.totalBalance, end: last.debts.totalBalance, change: round2(last.debts.totalBalance - first.debts.totalBalance) },
    liquidity: (() => {
      const start = liquidityTotal(first, { opening: true });
      const end = liquidityTotal(last);
      return { start, end, change: round2(end - start) };
    })(),
    categories,
    products,
    distribution: last.portfolio.categories.map((c) => ({ code: c.code, name: c.name, final: c.code === 'LIQUIDEZ' ? liquidityEnd : c.final, share: c.share })),
    monthly,
  };
  report.observations = buildObservations(report);
  return report;
}

export function buildObservations(r) {
  const obs = [];
  const p = r.patrimony;
  obs.push(`El patrimonio pasó de ${fmt(p.opening)} a ${fmt(p.final)} (variación de ${fmt(p.variation)}).`);
  obs.push(
    `De esa variación, ${fmt(p.netMovement)} corresponde a movimientos netos (aportaciones ${fmt(p.contributions)} menos deducciones ${fmt(p.withdrawals)}) y ${fmt(p.profitability)} a rentabilidad registrada.`,
  );
  if (r.cashflow.income > 0)
    obs.push(`Los ingresos acumulados fueron ${fmt(r.cashflow.income)} y los gastos ${fmt(r.cashflow.expenses)}; la capacidad de ahorro acumulada fue ${fmt(r.cashflow.savings)} (${r.cashflow.savingsRate}% de los ingresos).`);
  if (r.debt.start !== 0 || r.debt.end !== 0)
    obs.push(`La deuda total registrada pasó de ${fmt(r.debt.start)} a ${fmt(r.debt.end)}.`);
  if (r.liquidity.start !== 0 || r.liquidity.end !== 0)
    obs.push(`La liquidez y protección registrada pasó de ${fmt(r.liquidity.start)} a ${fmt(r.liquidity.end)}.`);

  const withRoi = r.monthly.filter((m) => m.roi !== null);
  if (withRoi.length > 1) {
    const best = withRoi.reduce((a, b) => (b.roi > a.roi ? b : a));
    const worst = withRoi.reduce((a, b) => (b.roi < a.roi ? b : a));
    obs.push(`El mes con mayor ROI de portafolio fue ${MONTHS[best.month - 1]} (${best.roi}%) y el de menor fue ${MONTHS[worst.month - 1]} (${worst.roi}%).`);
  }
  const top = [...r.distribution].sort((a, b) => b.share - a.share)[0];
  if (top) obs.push(`Al cierre, la categoría con mayor participación fue ${top.name} (${top.share}% del portafolio).`);
  if (!r.complete) obs.push(`Informe parcial: ${r.monthsClosed} de 12 periodos cerrados.`);
  return obs;
}
