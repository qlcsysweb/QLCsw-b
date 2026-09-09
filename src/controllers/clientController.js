const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { decrypt } = require('../utils/crypto');
const documentStorage = require('../services/documentStorage');

const PROCESS_CONDITION_TYPES = ['CONTRACT', 'FUNDS', 'PAYMENT', 'API', 'ACTIVATION'];

// Resumen de avance del proceso — para el indicador de "listo para activar"
// (alcance §7: "indicador para facilitar la identificación de clientes que
// ya cumplieron las condiciones necesarias").
function summarizeConditions(process) {
  const conditions = process?.conditions || [];
  const total = conditions.length;
  const confirmed = conditions.filter((c) => c.status === 'CONFIRMED').length;
  const rejected = conditions.filter((c) => c.status === 'REJECTED').length;
  return {
    total,
    confirmed,
    rejected,
    allConfirmed: total > 0 && confirmed === total,
  };
}

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

  const [rows, total] = await Promise.all([
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

  const items = rows.map((c) => ({ ...c, conditionsSummary: summarizeConditions(c.process) }));

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

  // El admin puede visualizar y copiar la API Key/Secret real (alcance §8)
  // — se descifra SOLO aquí (vista de un cliente puntual), nunca en el
  // listado, y el ciphertext crudo nunca se envía al frontend.
  const { apiKeyEncrypted, apiSecretEncrypted, ...apiConnectionRest } = client.apiConnection || {};
  const shapedApiConnection = client.apiConnection
    ? {
        ...apiConnectionRest,
        apiKey: apiKeyEncrypted ? decrypt(apiKeyEncrypted) : null,
        apiSecret: apiSecretEncrypted ? decrypt(apiSecretEncrypted) : null,
      }
    : null;

  res.json({
    ok: true,
    client: {
      ...client,
      apiConnection: shapedApiConnection,
      conditionsSummary: summarizeConditions(client.process),
    },
  });
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

// Eliminación REAL y permanente del cliente (tu propia cuenta, perfil y
// TODO lo dependiente) — nunca una simple desactivación. Las relaciones
// hijas de ClientProfile ya están definidas con onDelete: Cascade en el
// schema (ClientModel, Process→ProcessCondition, Contract, Document,
// PaymentReport, SupportCase, ChatSession→ChatMessage, ApiConnection), así
// que borrar el User cascada de forma segura sin dejar huérfanos ni violar
// foreign keys. Appointment usa onDelete: SetNull deliberadamente (se
// conserva el historial de citas, sin cliente asociado).
//
// Esta ruta SOLO puede alcanzar clientes: un ClientProfile nunca existe
// para una cuenta ADMIN, así que es estructuralmente imposible borrar un
// administrador desde aquí.
const deleteClient = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, role: true } },
      contracts: true,
      documents: true,
      paymentReports: true,
    },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (client.user.role !== 'CLIENT') {
    // Defensa adicional: nunca debería ocurrir dado el modelo de datos.
    throw ApiError.badRequest('Esta acción solo puede eliminar cuentas de cliente.');
  }

  // Borra los archivos reales en Google Drive ANTES de borrar las filas
  // (una vez cascadeada la eliminación en BD, los driveFileId ya no
  // existirían en ningún lado para poder limpiarlos). Best-effort: si Drive
  // no está configurado o un archivo puntual falla, no bloquea el borrado.
  if (await documentStorage.isConfigured()) {
    const fileIds = [
      ...client.contracts.flatMap((c) => [c.originalDriveFileId, c.signedDriveFileId]),
      ...client.documents.map((d) => d.driveFileId),
      ...client.paymentReports.map((p) => p.proofDriveFileId),
    ].filter(Boolean);
    await Promise.all(fileIds.map((id) => documentStorage.deleteDocument(id).catch(() => {})));
  }

  await prisma.user.delete({ where: { id: client.user.id } });

  res.json({ ok: true });
});

module.exports = {
  listClients,
  getClient,
  createClient,
  updateClient,
  setClientActive,
  selectClientModel,
  deleteClient,
};
