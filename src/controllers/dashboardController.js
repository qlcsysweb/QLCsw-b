const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const { countUnregisteredProspects } = require('./prospectController');

const getSummary = asyncHandler(async (req, res) => {
  const [
    totalClients,
    activeClients,
    pendingClients,
    reviewClients,
    inactiveClients,
    readyToActivate,
    newProspects,
    unregisteredProspects,
    pendingAppointments,
    pendingPayments,
    pendingContracts,
    recentDocuments,
    connectedApis,
    disconnectedApis,
    pendingApis,
  ] = await Promise.all([
    prisma.clientProfile.count(),
    prisma.clientProfile.count({ where: { status: 'ACTIVE' } }),
    prisma.clientProfile.count({ where: { status: 'PENDING' } }),
    prisma.clientProfile.count({ where: { status: 'REVIEW' } }),
    prisma.clientProfile.count({ where: { status: 'INACTIVE' } }),
    // Clientes con todas sus condiciones de proceso confirmadas pero que
    // TODAVÍA no fueron activados — el indicador de "listos para activar"
    // del alcance §7.
    prisma.process.count({
      where: {
        isActivated: false,
        conditions: { every: { status: 'CONFIRMED' }, some: {} },
      },
    }),
    prisma.prospect.count({ where: { status: 'NUEVO' } }),
    countUnregisteredProspects(),
    prisma.appointment.count({ where: { status: 'PENDING' } }),
    prisma.paymentReport.count({ where: { status: { in: ['PENDING', 'EN_REVISION'] } } }),
    prisma.contract.count({ where: { status: { in: ['PENDING', 'UPLOADED'] } } }),
    prisma.document.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { client: { select: { firstName: true, lastName: true } } },
    }),
    prisma.apiSubaccount.count({ where: { status: 'CONECTADA' } }),
    prisma.apiSubaccount.count({ where: { status: 'DESCONECTADA' } }),
    prisma.apiSubaccount.count({ where: { status: 'PENDIENTE' } }),
  ]);

  res.json({
    ok: true,
    summary: {
      clients: {
        total: totalClients,
        active: activeClients,
        pending: pendingClients,
        review: reviewClients,
        inactive: inactiveClients,
      },
      readyToActivate,
      prospects: { new: newProspects, unregistered: unregisteredProspects },
      appointments: { pending: pendingAppointments },
      payments: { pending: pendingPayments },
      contracts: { pending: pendingContracts },
      apiConnections: {
        connected: connectedApis,
        disconnected: disconnectedApis,
        pending: pendingApis,
      },
      recentDocuments,
    },
  });
});

module.exports = { getSummary };
