const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const documentStorage = require('../services/documentStorage');
const { enforceCommissionDeadline } = require('../utils/connectionDeadlines');
const { ensurePrincipalSubaccount } = require('../utils/subaccountProvisioning');
const { verifyClientDeletionPassword } = require('./securityConfigController');

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

// CORRECCIÓN 6/17/18: sin teléfono. El correo sigue siendo el identificador
// real de acceso (login). CORRECCIÓN 2 (bloque de 20) — "username" es una
// nomenclatura libre adicional que define QLC (ej. "QLC001") para
// identificar al cliente en el panel; es independiente del correo y nunca
// se usa para iniciar sesión.
const createClientSchema = z.object({
  username: z.string().min(1).optional(),
  firstName: z.string().min(1, 'El nombre es obligatorio'),
  lastName: z.string().min(1, 'El apellido es obligatorio'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  // CORRECCIÓN 4: opcional aquí (el admin puede completarla después desde
  // "Editar cliente") — en el registro público sí es obligatoria.
  nationality: z.string().optional(),
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
            { username: { contains: search, mode: 'insensitive' } },
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
          paymentReports: { orderBy: { reportedAt: 'desc' } },
          statements: { orderBy: { createdAt: 'desc' } },
          connectionEvents: { orderBy: { occurredAt: 'desc' } },
          capitalDistributionItems: true,
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

  if (data.username) {
    const existingUsername = await prisma.clientProfile.findUnique({ where: { username: data.username } });
    if (existingUsername) throw ApiError.conflict('Ese usuario ya está en uso por otro cliente');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          username: data.username || null,
          firstName: data.firstName,
          lastName: data.lastName,
          nationality: data.nationality || null,
          notes: data.notes,
          status: 'PENDING',
        },
      },
    },
    include: { clientProfile: true },
  });

  // GESTIÓN DINÁMICA DE SUBCUENTAS — igual que en el registro público: solo
  // la cuenta PRINCIPAL nace automáticamente, también cuando el ADMIN da de
  // alta al cliente directamente.
  await ensurePrincipalSubaccount(user.clientProfile.id);

  res.status(201).json({ ok: true, client: user.clientProfile });
});

// CORRECCIÓN 2 (bloque de 20) — el admin edita usuario/nombre/correo/
// contraseña desde un único modal. "username" es libre y opcional;
// "email"/"password" siguen viviendo en User (login), nunca en
// ClientProfile. Un password vacío/omitido conserva el actual — nunca se
// exige cambiarlo.
const updateClientSchema = z.object({
  username: z.string().min(1).nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email('Email inválido').optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
  nationality: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'REVIEW']).optional(),
});

const updateClient = asyncHandler(async (req, res) => {
  const data = updateClientSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  if (data.username !== undefined && data.username !== null && data.username !== client.username) {
    const clash = await prisma.clientProfile.findUnique({ where: { username: data.username } });
    if (clash) throw ApiError.conflict('Ese usuario ya está en uso por otro cliente');
  }

  if (data.email && data.email !== client.user.email) {
    const clash = await prisma.user.findUnique({ where: { email: data.email } });
    if (clash) throw ApiError.conflict('Ya existe un usuario con ese email');
  }

  if (data.email || data.password) {
    await prisma.user.update({
      where: { id: client.userId },
      data: {
        ...(data.email ? { email: data.email } : {}),
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 12) } : {}),
      },
    });
  }

  const { email, password, ...profileData } = data;
  const updated = await prisma.clientProfile.update({
    where: { id: req.params.id },
    data: profileData,
    include: { user: { select: { email: true, isActive: true, lastLoginAt: true } } },
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
// ApiSubaccount→ClientModel/Process/PaymentReport/Statement/
// ApiConnectionEvent) están definidas con onDelete: Cascade (excepto
// Appointment, que usa SetNull a propósito para conservar el historial de
// citas), así que borrar el User cascada de forma segura sin huérfanos.
//
// Esta ruta SOLO puede alcanzar clientes: un ClientProfile nunca existe
// para una cuenta ADMIN, así que es estructuralmente imposible borrar un
// administrador desde aquí.
// CORREGIR.xlsx ADMIN 06: solo el administrador general puede eliminar
// clientes, y siempre con la contraseña de seguridad exclusiva — validado
// en backend, nunca solo en frontend, e imposible de sortear vía API
// directa porque la verificación ocurre aquí mismo antes de tocar la BD.
const deleteClient = asyncHandler(async (req, res) => {
  await verifyClientDeletionPassword(req.user.id, req.body?.securityPassword);

  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, role: true, isActive: true } },
      documents: true,
      apiSubaccounts: { include: { paymentReports: true, statements: true } },
    },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (client.user.role !== 'CLIENT') {
    // Defensa adicional: nunca debería ocurrir dado el modelo de datos.
    throw ApiError.badRequest('Esta acción solo puede eliminar cuentas de cliente.');
  }
  if (client.user.isActive) {
    throw ApiError.badRequest('Primero debes desactivar a este cliente antes de poder eliminarlo.');
  }

  // Borra los archivos reales en Google Drive ANTES de borrar las filas
  // (una vez cascadeada la eliminación en BD, los driveFileId ya no
  // existirían en ningún lado para poder limpiarlos). Best-effort: si Drive
  // no está configurado o un archivo puntual falla, no bloquea el borrado.
  if (await documentStorage.isConfigured()) {
    const fileIds = [
      ...client.documents.map((d) => d.driveFileId),
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
