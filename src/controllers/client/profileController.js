const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');
const { currentStatementSummary, enforceCommissionDeadline } = require('../../utils/connectionDeadlines');

// Estado de cuenta ÚNICO del cliente para el dashboard, a partir del estado
// actual de cada subcuenta/API: VENCIDO > PENDIENTE (el que vence primero)
// > PAGADO > NO GENERADO.
function aggregateStatementStatus(summaries) {
  const overdue = summaries.find((s) => s.status === 'VENCIDO_SIN_PAGAR');
  if (overdue) return { ...overdue, pendingCount: summaries.filter((s) => s.status !== 'PAGADO' && s.status !== 'NO_GENERADO').length };
  const pending = summaries
    .filter((s) => s.status === 'PENDIENTE_DE_PAGO')
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
  if (pending.length) return { ...pending[0], pendingCount: pending.length };
  const paid = summaries.find((s) => s.status === 'PAGADO');
  if (paid) return { ...paid, pendingCount: 0 };
  return { status: 'NO_GENERADO', expiresAt: null, pendingCount: 0 };
}

// CORRECCIÓN 6/17/18: sin teléfono, sin username — el correo es el único
// identificador. El "perfil" del cliente ya no incluye un modelo único: el
// modelo pertenece a cada subcuenta/API (CORRECCIÓN 11/12).
const getMe = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.clientProfile.id },
    include: { user: { select: { email: true, createdAt: true } } },
  });
  res.json({
    ok: true,
    profile: {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      nationality: client.nationality,
      status: client.status,
      email: client.user.email,
      memberSince: client.user.createdAt,
    },
  });
});

// CORRECCIÓN 11/12: el dashboard resume TODAS las subcuentas/API del
// cliente (hasta 20), cada una con su propio modelo/proceso.
const getDashboard = asyncHandler(async (req, res) => {
  const clientId = req.clientProfile.id;

  const activeIds = await prisma.apiSubaccount.findMany({ where: { clientId, deactivatedAt: null }, select: { id: true } });
  await Promise.all(activeIds.map((s) => enforceCommissionDeadline(s.id)));

  const [client, subaccounts, unreadNotifications, nextAppointment] = await Promise.all([
    prisma.clientProfile.findUnique({ where: { id: clientId } }),
    prisma.apiSubaccount.findMany({
      where: { clientId, deactivatedAt: null },
      orderBy: { slotIndex: 'asc' },
      include: {
        clientModel: { include: { model: true } },
        process: { include: { conditions: { where: { type: { not: 'WALLET' } } } } },
        statements: { orderBy: { generatedAt: 'desc' }, take: 1 },
      },
    }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    prisma.appointment.findFirst({
      where: { clientId, status: { in: ['PENDING', 'AUTORIZADA'] } },
      orderBy: { requestedDate: 'asc' },
    }),
  ]);

  const withSummary = subaccounts.map((s) => ({
    subaccount: s,
    statementSummary: { ...currentStatementSummary(s.statements), apiSubaccountId: s.id, identifier: s.identifier, isPrincipal: s.isPrincipal },
  }));

  res.json({
    ok: true,
    // Hora del servidor: el frontend corrige el desfase de reloj del
    // dispositivo al dibujar el contador (nunca es la fuente de verdad).
    serverTime: new Date().toISOString(),
    dashboard: {
      statement: aggregateStatementStatus(withSummary.map((w) => w.statementSummary)),
      firstName: client.firstName,
      status: client.status,
      subaccounts: subaccounts.map((s) => ({
        id: s.id,
        identifier: s.identifier,
        isPrincipal: s.isPrincipal,
        slotIndex: s.slotIndex,
        apiStatus: s.status,
        model: s.clientModel?.model || null,
        process: s.process,
        statementSummary: withSummary.find((w) => w.subaccount.id === s.id).statementSummary,
      })),
      unreadNotifications,
      nextAppointment,
    },
  });
});

module.exports = { getMe, getDashboard };
