const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const PROCESS_CONDITION_TYPES = ['CONTRACT', 'FUNDS', 'PAYMENT', 'API', 'ACTIVATION'];

const createClientSchema = z.object({
  firstName: z.string().min(1, 'El nombre es obligatorio'),
  lastName: z.string().min(1, 'El apellido es obligatorio'),
  email: z.string().email('Email inválido'),
  phone: z.string().optional(),
  username: z.string().min(3, 'El usuario debe tener al menos 3 caracteres'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  modelKey: z.enum(['FLEXIBLE', 'PERFORMANCE', 'COMPOUND']).optional(),
  notes: z.string().optional(),
});

const listClients = asyncHandler(async (req, res) => {
  const { search, status, page = '1', pageSize = '20' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 20, 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { username: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.clientProfile.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, username: true, isActive: true, lastLoginAt: true } },
        clientModel: { include: { model: true } },
        process: { include: { conditions: true } },
        apiConnection: { select: { status: true, exchangeName: true } },
      },
    }),
    prisma.clientProfile.count({ where }),
  ]);

  res.json({ ok: true, items, total, page: Number(page), pageSize: take });
});

const getClient = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { email: true, username: true, isActive: true, lastLoginAt: true, createdAt: true } },
      clientModel: { include: { model: true } },
      process: { include: { conditions: true } },
      apiConnection: true,
      contracts: { orderBy: { createdAt: 'desc' } },
      documents: { orderBy: { createdAt: 'desc' } },
      paymentReports: { orderBy: { reportedAt: 'desc' } },
      appointments: { orderBy: { requestedDate: 'desc' } },
      supportCases: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  res.json({ ok: true, client });
});

const createClient = asyncHandler(async (req, res) => {
  const data = createClientSchema.parse(req.body);

  const [existingEmail, existingUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email: data.email } }),
    prisma.user.findUnique({ where: { username: data.username } }),
  ]);
  if (existingEmail) throw ApiError.conflict('Ya existe un usuario con ese email');
  if (existingUsername) throw ApiError.conflict('Ya existe un usuario con ese nombre de usuario');

  let model = null;
  if (data.modelKey) {
    model = await prisma.model.findUnique({ where: { key: data.modelKey } });
    if (!model) throw ApiError.badRequest('Modelo seleccionado no válido');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      username: data.username,
      passwordHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          notes: data.notes,
          status: 'PENDING',
          process: {
            create: {
              conditions: {
                create: PROCESS_CONDITION_TYPES.map((type) => ({ type, status: 'PENDING' })),
              },
            },
          },
          apiConnection: { create: { status: 'PENDIENTE' } },
          ...(model
            ? { clientModel: { create: { modelId: model.id, confirmedAt: new Date() } } }
            : {}),
        },
      },
    },
    include: { clientProfile: true },
  });

  res.status(201).json({ ok: true, client: user.clientProfile });
});

const updateClientSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'REVIEW']).optional(),
});

const updateClient = asyncHandler(async (req, res) => {
  const data = updateClientSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const updated = await prisma.clientProfile.update({
    where: { id: req.params.id },
    data,
  });

  res.json({ ok: true, client: updated });
});

const setClientActive = asyncHandler(async (req, res) => {
  const schema = z.object({ isActive: z.boolean() });
  const { isActive } = schema.parse(req.body);

  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  await prisma.user.update({ where: { id: client.userId }, data: { isActive } });
  const updated = await prisma.clientProfile.update({
    where: { id: req.params.id },
    data: { status: isActive ? 'ACTIVE' : 'INACTIVE' },
  });

  res.json({ ok: true, client: updated });
});

const selectClientModel = asyncHandler(async (req, res) => {
  const schema = z.object({ modelKey: z.enum(['FLEXIBLE', 'PERFORMANCE', 'COMPOUND']) });
  const { modelKey } = schema.parse(req.body);

  const model = await prisma.model.findUnique({ where: { key: modelKey } });
  if (!model) throw ApiError.badRequest('Modelo no válido');

  const clientModel = await prisma.clientModel.upsert({
    where: { clientId: req.params.id },
    update: { modelId: model.id, confirmedAt: new Date() },
    create: { clientId: req.params.id, modelId: model.id, confirmedAt: new Date() },
    include: { model: true },
  });

  res.json({ ok: true, clientModel });
});

module.exports = {
  listClients,
  getClient,
  createClient,
  updateClient,
  setClientActive,
  selectClientModel,
};
