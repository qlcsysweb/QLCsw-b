const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const driveStorage = require('../services/driveStorageService');
const { enforceCommissionDeadline, currentStatementSummary } = require('../utils/connectionDeadlines');
const { ensurePrincipalSubaccount } = require('../utils/subaccountProvisioning');
const { syncClientStatus, computeClientStatus } = require('../utils/clientStatus');
const { isAccountActivated } = require('../utils/accountActivation');
const { resolveActiveReferrer, logAffiliateEvent } = require('../services/affiliateService');
const { recordReferralLock } = require('../utils/referralLock');
const { createApiPermissionsNotice, emailExistingNotification } = require('../utils/notify');

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
  const activated = apiSubaccounts.filter(isAccountActivated).length;
  const readyToActivate = apiSubaccounts.filter((s) => {
    const summary = summarizeConditions(s.process);
    return summary.allConfirmed && !isAccountActivated(s);
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
  notes: z.string().optional(),
  // AFILIACIÓN — el ADMIN decide explícitamente: sin afiliado, o con afiliado
  // identificado por su CÓDIGO (nunca un ID; el backend resuelve el cliente).
  withAffiliate: z.boolean().optional().default(false),
  affiliateCode: z.string().trim().max(64).optional(),
}).refine((d) => !d.withAffiliate || Boolean(d.affiliateCode), {
  message: 'Indica y valida el código de afiliado, o elige "Sin afiliado".',
  path: ['affiliateCode'],
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
          include: { process: { include: { conditions: { where: { type: { not: 'WALLET' } } } } }, clientModel: { include: { model: true } } },
        },
      },
    }),
    prisma.clientProfile.count({ where }),
  ]);

  const items = rows.map((c) => ({
    ...c,
    status: computeClientStatus({ userIsActive: c.user?.isActive, storedStatus: c.status, subaccounts: c.apiSubaccounts }),
    subaccountsSummary: summarizeSubaccounts(c.apiSubaccounts.filter((s) => !s.deactivatedAt)),
  }));

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
      user: { select: { email: true, isActive: true, lastLoginAt: true, createdAt: true, twoFactorEnabled: true } },
      documents: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { corrections: true } } } },
      appointments: { orderBy: { requestedDate: 'desc' } },
      supportCases: { orderBy: { createdAt: 'desc' } },
      apiSubaccounts: {
        orderBy: { slotIndex: 'asc' },
        include: {
          clientModel: { include: { model: true } },
          process: { include: { conditions: { where: { type: { not: 'WALLET' } } } } },
          paymentReports: { orderBy: { reportedAt: 'desc' } },
          statements: { orderBy: { generatedAt: 'desc' } },
          connectionEvents: { where: { hiddenAt: null }, orderBy: { occurredAt: 'desc' } },
        },
      },
    },
  });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  res.json({
    ok: true,
    client: {
      ...client,
      // Estado calculado con sus cuentas reales (ver utils/clientStatus).
      status: computeClientStatus({ userIsActive: client.user?.isActive, storedStatus: client.status, subaccounts: client.apiSubaccounts }),
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
        statementSummary: currentStatementSummary(s.statements),
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

  if (data.withAffiliate) await resolveActiveReferrer(prisma, data.affiliateCode);

  const passwordHash = await bcrypt.hash(data.password, 12);

  // Cliente + relación de afiliación (si aplica) en la misma transacción.
  let user;
  let referrer = null;
  let apiNotice = null;
  try {
    ({ user, referrer, apiNotice } = await prisma.$transaction(async (tx) => {
      const activeReferrer = data.withAffiliate ? await resolveActiveReferrer(tx, data.affiliateCode) : null;
      const created = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          role: 'CLIENT',
          clientProfile: {
            create: {
              username: data.username,
              firstName: data.firstName,
              lastName: data.lastName,
              notes: data.notes,
              status: 'PENDING',
              ...(activeReferrer
                ? { referredByClientId: activeReferrer.id, referredAt: new Date(), referralSource: 'ADMIN', referralCodeUsed: activeReferrer.affiliateCode }
                : {}),
            },
          },
        },
        include: { clientProfile: true },
      });
      if (activeReferrer) {
        await recordReferralLock(tx, {
          clientId: created.clientProfile.id,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          referrerClientId: activeReferrer.id,
          referrerCode: activeReferrer.affiliateCode,
          source: 'ADMIN',
        });
      }
      // Aviso único "Permisos de API" del cliente nuevo (ver utils/notify).
      const apiNotice = await createApiPermissionsNotice(tx, created.id);
      return { user: created, referrer: activeReferrer, apiNotice };
    }));
  } catch (err) {
    if (err.code === 'P2002') throw ApiError.conflict('Ya existe un usuario con ese email o esa nomenclatura.');
    throw err;
  }
  await logAffiliateEvent(prisma, {
    action: referrer ? 'CLIENT_CREATED_BY_ADMIN_WITH_AFFILIATE' : 'CLIENT_CREATED_BY_ADMIN_WITHOUT_AFFILIATE',
    clientId: user.clientProfile.id,
    actorUserId: req.user.id,
    details: referrer ? { referrerClientId: referrer.id, affiliateCode: referrer.affiliateCode } : null,
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

  // Correo del aviso "Permisos de API" (best effort, nunca bloquea el alta).
  await emailExistingNotification(apiNotice, data.email);

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
  notes: z.string().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'REVIEW']).optional(),
});

const updateClient = asyncHandler(async (req, res) => {
  const data = updateClientSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  // Notas sí; estado, correo o contraseña no, si el titular pidió eliminarla.
  if (data.status || data.email || data.password) assertNoDeletionRequest(client);

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
  const username = assignUsernameSchema.parse(req.body).username.trim();
  if (!username) throw ApiError.badRequest('La nomenclatura única es obligatoria');
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');
  // EDITABLE por el admin (asignar o corregir). Sigue siendo ÚNICA: no puede
  // repetirse entre clientes (lo garantiza también el índice único de la BD).
  if (client.username === username) {
    return res.json({ ok: true, client });
  }

  const clash = await prisma.clientProfile.findUnique({ where: { username } });
  if (clash && clash.id !== client.id) throw ApiError.conflict('Esa nomenclatura ya está en uso por otro cliente.');

  let updated;
  try {
    updated = await prisma.clientProfile.update({
      where: { id: req.params.id },
      data: { username },
    });
  } catch (err) {
    if (err.code === 'P2002') throw ApiError.conflict('Esa nomenclatura ya está en uso por otro cliente.');
    throw err;
  }

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
  assertNoDeletionRequest(client);

  await prisma.user.update({ where: { id: client.userId }, data: { isActive } });
  // El estado se recalcula con sus cuentas reales: reactivar el acceso ya no
  // marca "ACTIVA" a un cliente que no tiene ninguna cuenta activada.
  await syncClientStatus(client.id);
  const updated = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });

  res.json({ ok: true, client: updated });
});

// ADMIN NO PUEDE ELIMINAR CUENTAS DE CLIENTES — regla definitiva. La antigua
// eliminación real (borrado en cascada de perfil, subcuentas, documentos,
// estados de cuenta y la carpeta completa de Drive) se retiró por completo:
// la ruta DELETE /admin/clients/:id responde 403 siempre, aunque el admin
// tenga sesión válida y permisos completos (incluido el admin general).
// La eliminación solo la solicita el propio titular desde su perfil, con
// contraseña + Google Authenticator (client/accountDeletionController).
const rejectClientDeletion = asyncHandler(async () => {
  throw ApiError.forbidden('Los administradores no pueden eliminar cuentas de clientes. Solo el titular puede solicitar la eliminación desde su perfil.');
});

// Cuenta con solicitud de eliminación registrada por su titular: ADMIN puede
// consultarla, pero no reactivarla ni cambiar su acceso/credenciales.
function assertNoDeletionRequest(client) {
  if (client?.accountDeletionStatus) {
    throw ApiError.forbidden('Esta cuenta tiene una solicitud de eliminación registrada por su titular: su acceso no puede reactivarse ni modificarse.');
  }
}

module.exports = {
  listClients,
  getClient,
  createClient,
  updateClient,
  assignUsername,
  setClientActive,
  rejectClientDeletion,
};
