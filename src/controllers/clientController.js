const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const driveStorage = require('../services/driveStorageService');
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
// real de acceso (login).
//
// NOMENCLATURA ÚNICA DEL CLIENTE — "username" ya NO es opcional cuando el
// ADMIN registra manualmente a un cliente: es el identificador que QLC usa
// para reconocerlo y para nombrar su carpeta de Google Drive. Cualquier
// carácter, máximo 30, sin formato impuesto ni ejemplo sugerido (para no
// inducir un formato). Se asigna UNA sola vez — ver updateClient, que la
// rechaza si el cliente ya tiene una.
const createClientSchema = z.object({
  username: z.string().min(1, 'La nomenclatura única es obligatoria').max(30, 'Máximo 30 caracteres'),
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

  const existingUsername = await prisma.clientProfile.findUnique({ where: { username: data.username } });
  if (existingUsername) throw ApiError.conflict('Esa nomenclatura ya está en uso por otro cliente.');

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          username: data.username,
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

  // IMPLEMENTACIÓN DEFINITIVA DE GOOGLE DRIVE — igual que en el registro
  // público: se intenta preparar la carpeta, nunca bloquea la creación.
  if (await driveStorage.isConfigured()) {
    await driveStorage.getOrCreateClientFolder(user.clientProfile).catch((err) => {
      prisma.clientProfile
        .update({ where: { id: user.clientProfile.id }, data: { driveSyncStatus: 'ERROR', driveSyncError: err.message } })
        .catch(() => {});
    });
  }

  res.status(201).json({ ok: true, client: user.clientProfile });
});

// CORRECCIÓN 2 (bloque de 20) — el admin edita nombre/correo/contraseña
// desde un único modal. "email"/"password" siguen viviendo en User (login),
// nunca en ClientProfile. Un password vacío/omitido conserva el actual —
// nunca se exige cambiarlo.
//
// NOMENCLATURA ÚNICA — "username" NO forma parte de este schema a
// propósito: una vez asignada, ni el cliente ni el admin pueden editarla
// (ver §11). Cualquier "username" que llegue en el body se ignora
// silenciosamente aquí (zod.strip() por defecto) — la única forma de
// asignarla es assignUsername, y solo cuando el cliente todavía no tiene una.
const updateClientSchema = z.object({
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

// NOMENCLATURA ÚNICA §9/§11 — único punto donde se puede ASIGNAR (nunca
// editar) la nomenclatura de un cliente. Rechaza explícitamente si el
// cliente ya tiene una — inmutable una vez guardada, sin excepción, ni
// siquiera para el admin. Si el cliente ya tenía una carpeta de Drive
// creada con un nombre provisional (por haber subido algo antes de tener
// nomenclatura), la renombra en vez de duplicarla.
const assignUsernameSchema = z.object({
  username: z.string().min(1, 'La nomenclatura única es obligatoria').max(30, 'Máximo 30 caracteres'),
});

const assignUsername = asyncHandler(async (req, res) => {
  const { username } = assignUsernameSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (client.username) {
    throw ApiError.conflict('Este cliente ya tiene una nomenclatura asignada. No puede cambiarse.');
  }

  const clash = await prisma.clientProfile.findUnique({ where: { username } });
  if (clash) throw ApiError.conflict('Esa nomenclatura ya está en uso por otro cliente.');

  const updated = await prisma.clientProfile.update({
    where: { id: req.params.id },
    data: { username },
  });

  // IMPLEMENTACIÓN DEFINITIVA DE GOOGLE DRIVE — best-effort, nunca bloquea
  // la asignación: si ya existe una carpeta (nombre provisional con el ID),
  // la renombra; si no existe todavía, no crea nada aquí (se creará sola en
  // el primer uso real, ya con el nombre correcto).
  if (await driveStorage.isConfigured()) {
    await driveStorage.renameClientFolderIfNeeded(updated).catch((err) => {
      prisma.clientProfile
        .update({ where: { id: updated.id }, data: { driveSyncStatus: 'ERROR', driveSyncError: err.message } })
        .catch(() => {});
    });
  }

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
    select: { walletAddress: true, walletNetwork: true, walletQrUrl: true, walletQrDriveFileId: true },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  res.json({ ok: true, wallet: { ...client, hasWalletQrDrive: Boolean(client.walletQrDriveFileId), walletQrDriveFileId: undefined } });
});

// Sirve el QR de wallet de ESTE cliente (por :id de la ruta) desde Drive,
// por un endpoint protegido de ADMIN — nunca un enlace público de Drive.
const downloadWalletQr = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.params.id },
    select: { walletQrDriveFileId: true },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  if (!client.walletQrDriveFileId) throw ApiError.notFound('No hay un QR de wallet almacenado en Drive.');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(client.walletQrDriveFileId);
  res.setHeader('Content-Type', mimeType || 'image/png');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || 'wallet-qr.png')}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// Eliminación REAL y permanente del cliente (su cuenta, perfil y TODO lo
// dependiente) — nunca una simple desactivación. Las relaciones hijas de
// ClientProfile (Document, Appointment→SetNull, SupportCase, ChatSession,
// ApiSubaccount→ClientModel/Process/PaymentReport/Statement/
// ApiConnectionEvent/SubaccountRequest) están definidas con onDelete:
// Cascade (excepto Appointment, que usa SetNull a propósito para conservar
// el historial de citas), así que un solo DELETE del User cascada de forma
// atómica y segura sin huérfanos — Postgres garantiza esto dentro de la
// misma sentencia, sin necesitar una transacción explícita adicional.
//
// Esta ruta SOLO puede alcanzar clientes: un ClientProfile nunca existe
// para una cuenta ADMIN, así que es estructuralmente imposible borrar un
// administrador desde aquí. El :id de la ruta es la única fuente del
// cliente objetivo — nunca se toma un ID de otro lado del body.
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

  // IMPLEMENTACIÓN DEFINITIVA DE GOOGLE DRIVE — borra la carpeta COMPLETA
  // del cliente (y todo su contenido: documentos, comprobantes, estados de
  // cuenta, QR) ANTES de borrar las filas en NeonDB — una vez cascadeada la
  // eliminación en BD, el driveClientFolderId ya no existiría en ningún
  // lado para poder limpiarlo. Nunca afirma "eliminada" si no se confirmó
  // de verdad: driveDeletionStatus refleja el resultado real.
  //   - "not_configured": Drive no está conectado — no se intentó nada.
  //   - "no_folder": el cliente nunca llegó a tener una carpeta en Drive.
  //   - "deleted": la llamada a Drive respondió sin error.
  //   - "error": se intentó y Drive devolvió un error (detalle en driveDeletionError).
  let driveDeletionStatus = 'not_configured';
  let driveDeletionError = null;
  if (await driveStorage.isConfigured()) {
    if (client.driveClientFolderId) {
      try {
        // Autorizado: ruta exclusiva de ADMIN GENERAL con contraseña de
        // seguridad ya verificada arriba antes de llegar aquí. Borrar la
        // carpeta borra en cascada TODO su contenido en Drive.
        await driveStorage.deleteDriveFileOnlyWhenAuthorized(client.driveClientFolderId, { authorized: true });
        driveDeletionStatus = 'deleted';
      } catch (err) {
        driveDeletionStatus = 'error';
        driveDeletionError = err.message;
      }
    } else {
      driveDeletionStatus = 'no_folder';
    }
  }

  await prisma.user.delete({ where: { id: client.user.id } });

  res.json({ ok: true, driveDeletionStatus, driveDeletionError });
});

module.exports = {
  listClients,
  getClient,
  createClient,
  updateClient,
  assignUsername,
  setClientActive,
  getWallet,
  downloadWalletQr,
  deleteClient,
};
