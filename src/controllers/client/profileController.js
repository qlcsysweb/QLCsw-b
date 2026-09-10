const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');

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
      status: client.status,
      email: client.user.email,
      memberSince: client.user.createdAt,
    },
  });
});

// CORRECCIÓN 11/12: el dashboard resume TODAS las subcuentas/API del
// cliente (hasta 20), cada una con su propio modelo/contrato/proceso.
const getDashboard = asyncHandler(async (req, res) => {
  const clientId = req.clientProfile.id;

  const [client, subaccounts, unreadNotifications, nextAppointment] = await Promise.all([
    prisma.clientProfile.findUnique({ where: { id: clientId } }),
    prisma.apiSubaccount.findMany({
      where: { clientId },
      orderBy: { slotIndex: 'asc' },
      include: {
        clientModel: { include: { model: true } },
        contract: true,
        process: { include: { conditions: true } },
      },
    }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    prisma.appointment.findFirst({
      where: { clientId, status: { in: ['PENDING', 'AUTORIZADA'] } },
      orderBy: { requestedDate: 'asc' },
    }),
  ]);

  res.json({
    ok: true,
    dashboard: {
      firstName: client.firstName,
      status: client.status,
      subaccounts: subaccounts.map((s) => ({
        id: s.id,
        identifier: s.identifier,
        apiStatus: s.status,
        model: s.clientModel?.model || null,
        contractStatus: s.contract?.status || 'PENDING',
        process: s.process,
      })),
      unreadNotifications,
      nextAppointment,
    },
  });
});

module.exports = { getMe, getDashboard };
