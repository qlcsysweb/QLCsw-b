const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const documentStorage = require('../services/documentStorage');
const { enforceCommissionDeadline } = require('../utils/connectionDeadlines');

const PROCESS_CONDITION_TYPES = ['CONTRACT', 'FUNDS', 'PAYMENT', 'API', 'ACTIVATION'];

// Resumen de avance de UNA subcuenta/API — para el indicador de "lista
// para activar" (una subcuenta está lista cuando todas sus condiciones
// están confirmadas y todavía no ha sido activada).
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

// Resumen agregado a nivel CLIENTE (para el listado) — un cliente puede
// tener hasta 20 subcuentas/API, cada una con su propio proceso.
function summarizeSubaccounts(apiSubaccounts) {
  const total = apiSubaccounts.length;
  const activated = apiSubaccounts.filter((s) => s.process?.isActivated).length;
  const readyToActivate = apiSubaccounts.filter((s) => {
    const summary = summarizeConditions(s.process);
    return summary.allConfirmed && !s.process?.isActivated;
  }).length;
  return { total, activated, readyToActivate };
}

// CORRECCIÓN 6/17/18: sin teléfono, sin username. El correo es el único
// identificador de acceso.
const createClientSchema = z.object({
  firstName: z.string().min(1, 'El nombre es obligatorio'),
  lastName: z.string().min(1, 'El apellido es obligatorio'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
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
            { apiSubaccounts: { some: { identifier: { contains: search, mode: 'insensitive' } } } },
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
        user: { select: { email: true, isActive: true, lastLoginAt: true } },
        apiSubaccounts: {
          include: { process: { include: { conditions: true } }, clientModel: { include: { model: true } } },
        },
      },
    }),
    prisma.clientProfile.count({ where }),
  ]);

  const items = rows.map((c) => ({ ...c, subaccountsSummary: summarizeSubaccounts(c.apiSubaccounts) }));

  res.json({ ok: true, items, total, page: Number(page), pageSize: take });
});

const getClient = asyncHandler(async (req, res) => {
  const preCheckIds = await prisma.apiSubaccount.findMany({
    where: { clientId: req.params.id },
    select: { id: true },
  });
  await Promise.all(preCheckIds.map((s) => enforceCommissionDeadline(s.id)));

  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { email: true, isActive: true, lastLoginAt: true, createdAt: true } },
      documents: { orderBy: { createdAt: 'desc' } },
      appointments: { orderBy: { requestedDate: 'desc' } },
      supportCases: { orderBy: { createdAt: 'desc' } },
      apiSubaccounts: {
        orderBy: { slotIndex: 'asc' },
        include: {
          clientModel: { include: { model: true } },
          process: { include: { conditions: true } },
          contract: true,
          paymentReports: { orderBy: { reportedAt: 'desc' } },
          statements: { orderBy: { createdAt: 'desc' } },
          connectionEvents: { orderBy: { occurredAt: 'desc' } },
        },
      },
    },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  res.json({
    ok: true,
    client: {
      ...client,
      apiSubaccounts: client.apiSubaccounts.map((s) => ({
        ...s,
        // Nunca se envía el ciphertext crudo — solo indicadores de presencia.
        // El admin ve/copia la clave real vía apiSubaccountController.getSecrets.
        apiKeyEncrypted: undefined,
        apiSecretEncrypted: undefined,
        apiPassphraseEncrypted: undefined,
        hasApiKey: Boolean(s.apiKeyEncrypted),
        hasApiSecret: Boolean(s.apiSecretEncrypted),
        hasApiPassphrase: Boolean(s.apiPassphraseEncrypted),
        conditionsSummary: summarizeConditions(s.process),
      })),
      subaccountsSummary: summarizeSubaccounts(client.apiSubaccounts),
    },
  });
});

const createClient = asyncHandler(async (req, res) => {
  const data = createClientSchema.parse(req.body);

  const existingEmail = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingEmail) throw ApiError.conflict('Ya existe un usuario con ese email');

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          firstName: data.firstName,
          lastName: data.lastName,
          notes: data.notes,
          status: 'PENDING',
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

// CORRECCIÓN 28: wallet personal del cliente (dato administrativo, nunca
// se ejecutan transferencias automáticas).
const getWallet = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.id },
    select: { walletAddress: true, walletNetwork: true, walletQrUrl: true },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  res.json({ ok: true, wallet: client });
});

// Eliminación REAL y permanente del cliente (su cuenta, perfil y TODO lo
// dependiente) — nunca una simple desactivación. Las relaciones hijas de
// ClientProfile (Document, Appointment→SetNull, SupportCase, ChatSession,
// ApiSubaccount→ClientModel/Process/Contract/PaymentReport/Statement/
// ApiConnectionEvent) están definidas con onDelete: Cascade (excepto
// Appointment, que usa SetNull a propósito para conservar el historial de
// citas), así que borrar el User cascada de forma segura sin huérfanos.
//
// Esta ruta SOLO puede alcanzar clientes: un ClientProfile nunca existe
// para una cuenta ADMIN, así que es estructuralmente imposible borrar un
// administrador desde aquí.
const deleteClient = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, role: true } },
      documents: true,
      apiSubaccounts: { include: { contract: true, paymentReports: true, statements: true } },
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
      ...client.documents.map((d) => d.driveFileId),
      ...client.apiSubaccounts.flatMap((s) => [s.contract?.originalDriveFileId, s.contract?.signedDriveFileId]),
      ...client.apiSubaccounts.flatMap((s) => s.paymentReports.map((p) => p.proofDriveFileId)),
      ...client.apiSubaccounts.flatMap((s) => s.statements.map((st) => st.pdfDriveFileId)),
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
  getWallet,
  deleteClient,
};
