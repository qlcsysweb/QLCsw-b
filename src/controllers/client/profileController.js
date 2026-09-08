const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

const getMe = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.clientProfile.id },
    include: {
      user: { select: { email: true, username: true, createdAt: true } },
      clientModel: { include: { model: true } },
    },
  });
  res.json({
    ok: true,
    profile: {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
      status: client.status,
      email: client.user.email,
      username: client.user.username,
      memberSince: client.user.createdAt,
      model: client.clientModel?.model || null,
    },
  });
});

const updateProfileSchema = z.object({
  phone: z.string().optional(),
});

// El cliente solo puede editar datos de contacto, nunca estado ni información administrativa
const updateMe = asyncHandler(async (req, res) => {
  const data = updateProfileSchema.parse(req.body);
  const updated = await prisma.clientProfile.update({
    where: { id: req.clientProfile.id },
    data,
  });
  res.json({ ok: true, profile: updated });
});

const getDashboard = asyncHandler(async (req, res) => {
  const clientId = req.clientProfile.id;

  const [client, process, contract, unreadNotifications, nextAppointment, connection] =
    await Promise.all([
      prisma.clientProfile.findUnique({
        where: { id: clientId },
        include: { clientModel: { include: { model: true } } },
      }),
      prisma.process.findUnique({ where: { clientId }, include: { conditions: true } }),
      prisma.contract.findFirst({ where: { clientId }, orderBy: { createdAt: 'desc' } }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
      prisma.appointment.findFirst({
        where: { clientId, status: { in: ['PENDING', 'AUTORIZADA'] } },
        orderBy: { requestedDate: 'asc' },
      }),
      prisma.apiConnection.findUnique({ where: { clientId } }),
    ]);

  res.json({
    ok: true,
    dashboard: {
      firstName: client.firstName,
      status: client.status,
      model: client.clientModel?.model || null,
      process,
      contractStatus: contract?.status || 'PENDING',
      apiConnectionStatus: connection?.status || 'PENDIENTE',
      unreadNotifications,
      nextAppointment,
    },
  });
});

const getProcess = asyncHandler(async (req, res) => {
  const process = await prisma.process.findUnique({
    where: { clientId: req.clientProfile.id },
    include: { conditions: true },
  });
  if (!process) throw ApiError.notFound('Proceso no encontrado');
  res.json({ ok: true, process });
});

const selectModelSchema = z.object({ modelKey: z.enum(['FLEXIBLE', 'PERFORMANCE', 'COMPOUND']) });

const selectModel = asyncHandler(async (req, res) => {
  const { modelKey } = selectModelSchema.parse(req.body);
  const model = await prisma.model.findUnique({ where: { key: modelKey } });
  if (!model || !model.isActive) throw ApiError.badRequest('Modelo no válido');

  const clientModel = await prisma.clientModel.upsert({
    where: { clientId: req.clientProfile.id },
    update: { modelId: model.id, confirmedAt: new Date() },
    create: { clientId: req.clientProfile.id, modelId: model.id, confirmedAt: new Date() },
    include: { model: true },
  });

  res.json({ ok: true, clientModel });
});

module.exports = { getMe, updateMe, getDashboard, getProcess, selectModel };
