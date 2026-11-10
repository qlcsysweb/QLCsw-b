import { prisma } from '../config/prisma.js';
import { buildAnnualReport } from '../domain/annual.js';
import { badRequest, notFound } from '../utils/httpError.js';

export async function generateAnnualReport(userId, year) {
  const closes = await prisma.monthlyClose.findMany({ where: { userId, year, supersededAt: null } });
  if (!closes.length) throw badRequest('No hay periodos cerrados en ese año');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  const snapshot = { user, ...buildAnnualReport(year, closes.map((c) => c.snapshot)) };
  return prisma.annualReport.upsert({
    where: { userId_year: { userId, year } },
    create: { userId, year, snapshot },
    update: { snapshot, generatedAt: new Date() },
  });
}

export const listAnnualReports = (userId) =>
  prisma.annualReport.findMany({ where: { userId }, orderBy: { year: 'desc' } });

// El informe se recalcula con los cortes vigentes al abrirlo: así un informe generado antes de
// una corrección del cálculo (p. ej. la liquidez) o de un nuevo corte nunca muestra cifras viejas.
export async function getAnnualReport(userId, year) {
  const report = await prisma.annualReport.findUnique({ where: { userId_year: { userId, year } } });
  if (!report) throw notFound('Informe no generado');
  const hasCloses = await prisma.monthlyClose.count({ where: { userId, year, supersededAt: null } });
  return hasCloses ? generateAnnualReport(userId, year) : report;
}

export async function closedYears(userId) {
  const rows = await prisma.monthlyClose.groupBy({
    by: ['year'],
    where: { userId, supersededAt: null },
    _count: { _all: true },
    orderBy: { year: 'desc' },
  });
  return rows.map((r) => ({ year: r.year, monthsClosed: r._count._all }));
}
