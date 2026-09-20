/*
 * GESTIÓN DINÁMICA DE SUBCUENTAS/API — punto único de la lógica de
 * solicitudes de creación/desactivación de subcuenta, para que el
 * controlador de cliente y el de admin nunca puedan divergir en las
 * validaciones (límite de 20, estados de cuenta pendientes, duplicados).
 *
 * Las subcuentas funcionan por ESTADO (ACTIVA/INACTIVA), nunca por
 * eliminación: "desactivar" y "activar" son reversibles y jamás borran la
 * fila ni su historial (estados de cuenta, pagos, documentos).
 */
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { notifyAdmins, notifyClient } = require('../utils/notify');
const {
  getNextSlotIndex,
  countActiveSubaccounts,
  hasPendingStatements,
  MAX_SUBACCOUNTS_PER_CLIENT,
  PROCESS_CONDITION_TYPES,
} = require('../utils/subaccountProvisioning');

function clientDisplayName(client) {
  return `${client.firstName} ${client.lastName}`;
}

async function requestCreateSubaccount({ clientId, reason, requestedByUserId }) {
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const duplicate = await prisma.subaccountRequest.findFirst({
    where: { clientId, type: 'CREATE', status: 'PENDING' },
  });
  if (duplicate) {
    throw ApiError.conflict('Ya tienes una solicitud de nueva subcuenta pendiente de revisión.');
  }

  const activeCount = await countActiveSubaccounts(clientId);
  if (activeCount >= MAX_SUBACCOUNTS_PER_CLIENT) {
    throw ApiError.conflict(`Ya tienes el máximo de ${MAX_SUBACCOUNTS_PER_CLIENT} subcuentas/API.`);
  }

  const request = await prisma.subaccountRequest.create({
    data: { clientId, type: 'CREATE', reason: reason || null, requestedByUserId },
  });

  await notifyAdmins({
    title: 'Solicitud de nueva subcuenta',
    message: `${clientDisplayName(client)} solicitó una subcuenta/API adicional (tiene ${activeCount}/${MAX_SUBACCOUNTS_PER_CLIENT} activas)${reason ? `. Motivo: ${reason}` : '.'}`,
    type: 'info',
    templateKey: 'subaccount_request_created_admin',
    templateParams: { clientName: clientDisplayName(client), clientId, requestId: request.id },
  });

  return request;
}

async function requestDeactivateSubaccount({ clientId, apiSubaccountId, reason, requestedByUserId }) {
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: apiSubaccountId, clientId },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (subaccount.isPrincipal) throw ApiError.badRequest('La cuenta PRINCIPAL no puede desactivarse.');
  if (subaccount.deactivatedAt) throw ApiError.conflict('Esta subcuenta ya está inactiva.');

  const duplicate = await prisma.subaccountRequest.findFirst({
    where: { apiSubaccountId, type: 'DEACTIVATE', status: 'PENDING' },
  });
  if (duplicate) {
    throw ApiError.conflict('Ya existe una solicitud de desactivación pendiente para esta subcuenta.');
  }

  if (await hasPendingStatements(apiSubaccountId)) {
    throw ApiError.conflict(
      'Esta subcuenta tiene un estado de cuenta con comisión pendiente de pago. Debes liquidarlo antes de solicitar su desactivación.'
    );
  }

  const request = await prisma.subaccountRequest.create({
    data: { clientId, type: 'DEACTIVATE', apiSubaccountId, reason: reason || null, requestedByUserId },
  });

  await notifyAdmins({
    title: 'Solicitud de desactivación de subcuenta',
    message: `${clientDisplayName(client)} solicitó desactivar la subcuenta/API ${subaccount.identifier || `#${subaccount.slotIndex}`}${reason ? `. Motivo: ${reason}` : '.'}`,
    type: 'warning',
    templateKey: 'subaccount_deactivate_request_created_admin',
    templateParams: { clientName: clientDisplayName(client), clientId, apiSubaccountId, requestId: request.id },
  });

  return request;
}

async function listRequestsForClient(clientId) {
  return prisma.subaccountRequest.findMany({
    where: { clientId },
    orderBy: { requestedAt: 'desc' },
    include: { apiSubaccount: { select: { id: true, identifier: true, slotIndex: true } } },
  });
}

async function listRequestsForAdmin({ status, type } = {}) {
  return prisma.subaccountRequest.findMany({
    where: { ...(status ? { status } : {}), ...(type ? { type } : {}) },
    orderBy: { requestedAt: 'desc' },
    include: {
      client: { select: { id: true, username: true, firstName: true, lastName: true, user: { select: { email: true } } } },
      apiSubaccount: { select: { id: true, identifier: true, slotIndex: true, status: true } },
      requestedBy: { select: { email: true } },
      reviewedBy: { select: { email: true } },
    },
  });
}

async function getPendingRequestOrThrow(requestId, type) {
  const request = await prisma.subaccountRequest.findUnique({
    where: { id: requestId },
    include: { client: true, apiSubaccount: true },
  });
  if (!request) throw ApiError.notFound('Solicitud no encontrada');
  if (request.type !== type) throw ApiError.badRequest('Tipo de solicitud incorrecto.');
  if (request.status !== 'PENDING') throw ApiError.conflict('Esta solicitud ya fue revisada.');
  return request;
}

async function approveCreateRequest({ requestId, identifier, requiredCapital, reviewedByUserId }) {
  const request = await getPendingRequestOrThrow(requestId, 'CREATE');

  const activeCount = await countActiveSubaccounts(request.clientId);
  if (activeCount >= MAX_SUBACCOUNTS_PER_CLIENT) {
    throw ApiError.conflict(`Este cliente ya alcanzó el máximo de ${MAX_SUBACCOUNTS_PER_CLIENT} subcuentas/API.`);
  }
  if (identifier) {
    const clash = await prisma.apiSubaccount.findUnique({ where: { identifier } });
    if (clash) throw ApiError.conflict('Ese identificador ya está en uso por otra subcuenta.');
  }

  const slotIndex = await getNextSlotIndex(request.clientId);
  const subaccount = await prisma.apiSubaccount.create({
    data: {
      clientId: request.clientId,
      slotIndex,
      identifier: identifier || null,
      requiredCapital: requiredCapital ?? null,
      updatedByUserId: reviewedByUserId,
      process: {
        create: {
          conditions: {
            create: PROCESS_CONDITION_TYPES.map((t) => ({
              type: t,
              status: t === 'WALLET' && request.client.walletAddress ? 'CONFIRMED' : 'PENDING',
            })),
          },
        },
      },
    },
  });

  const updatedRequest = await prisma.subaccountRequest.update({
    where: { id: requestId },
    data: { status: 'APPROVED', reviewedByUserId, reviewedAt: new Date() },
  });

  await notifyClient(request.clientId, {
    title: 'Nueva subcuenta aprobada',
    message: `QLC aprobó tu solicitud de subcuenta adicional${requiredCapital != null ? ` — capital operativo requerido: ${requiredCapital} USDT` : ''}.`,
    type: 'success',
    templateKey: 'subaccount_request_approved',
    templateParams: { apiSubaccountId: subaccount.id },
  });

  return { request: updatedRequest, subaccount };
}

async function approveDeactivateRequest({ requestId, reviewedByUserId }) {
  const request = await getPendingRequestOrThrow(requestId, 'DEACTIVATE');
  return deactivateSubaccount({
    clientId: request.clientId,
    apiSubaccountId: request.apiSubaccountId,
    deactivatedByUserId: reviewedByUserId,
    linkedRequestId: request.id,
  });
}

async function rejectRequest({ requestId, reviewNote, reviewedByUserId }) {
  const request = await prisma.subaccountRequest.findUnique({ where: { id: requestId }, include: { apiSubaccount: true } });
  if (!request) throw ApiError.notFound('Solicitud no encontrada');
  if (request.status !== 'PENDING') throw ApiError.conflict('Esta solicitud ya fue revisada.');

  const updated = await prisma.subaccountRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED', reviewNote: reviewNote || null, reviewedByUserId, reviewedAt: new Date() },
  });

  const isDeactivate = request.type === 'DEACTIVATE';
  await notifyClient(request.clientId, {
    title: isDeactivate ? 'Solicitud de desactivación rechazada' : 'Solicitud de nueva subcuenta rechazada',
    message: isDeactivate
      ? `QLC revisó tu solicitud de desactivar la subcuenta/API ${request.apiSubaccount?.identifier || `#${request.apiSubaccount?.slotIndex}`} y, por ahora, no fue posible autorizarla.${reviewNote ? ` Motivo: ${reviewNote}` : ''}`
      : `QLC revisó tu solicitud de subcuenta adicional y, por ahora, no fue posible habilitarla.${reviewNote ? ` Motivo: ${reviewNote}` : ''}`,
    type: 'warning',
    templateKey: isDeactivate ? 'subaccount_deactivate_request_rejected' : 'subaccount_request_rejected',
    templateParams: { apiSubaccountId: request.apiSubaccountId },
  });

  return updated;
}

// Núcleo compartido de "desactivar": usado tanto al aprobar una solicitud
// del cliente como al desactivar directamente desde el panel admin. NUNCA
// borra la fila — solo marca deactivatedAt/deactivatedByUserId, así que
// estados de cuenta, pagos, documentos y notificaciones históricas quedan
// intactos y consultables. Reversible en cualquier momento (ver
// activateSubaccount).
async function deactivateSubaccount({ clientId, apiSubaccountId, deactivatedByUserId, reviewNote, linkedRequestId }) {
  // Vuelve a cargar la subcuenta con el clientId como parte del WHERE —
  // esta es la defensa real contra IDOR: un id manipulado que pertenezca a
  // OTRO cliente simplemente no calza con este filtro y produce 404, nunca
  // desactiva una subcuenta ajena.
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (subaccount.isPrincipal) throw ApiError.badRequest('La cuenta PRINCIPAL no puede desactivarse.');
  if (subaccount.deactivatedAt) throw ApiError.conflict('Esta subcuenta ya está inactiva.');
  if (await hasPendingStatements(apiSubaccountId)) {
    throw ApiError.conflict(
      'Esta subcuenta tiene un estado de cuenta con comisión pendiente de pago. No puede desactivarse hasta que se liquide.'
    );
  }

  const deactivated = await prisma.apiSubaccount.update({
    where: { id: apiSubaccountId },
    data: { deactivatedAt: new Date(), deactivatedByUserId },
  });

  if (linkedRequestId) {
    await prisma.subaccountRequest.update({
      where: { id: linkedRequestId },
      data: { status: 'APPROVED', reviewedByUserId: deactivatedByUserId, reviewedAt: new Date() },
    });
  } else {
    // Desactivación directa desde el panel admin, sin una solicitud previa
    // del cliente — se registra igual como una solicitud ya resuelta, para
    // que el historial de acciones sobre esta subcuenta quede completo en
    // un solo lugar (fecha, usuario, estado).
    await prisma.subaccountRequest.create({
      data: {
        clientId,
        type: 'DEACTIVATE',
        apiSubaccountId,
        status: 'APPROVED',
        reviewNote: reviewNote || 'Desactivada directamente por un administrador desde el panel.',
        requestedByUserId: deactivatedByUserId,
        reviewedByUserId: deactivatedByUserId,
        reviewedAt: new Date(),
      },
    });
  }

  await notifyClient(clientId, {
    title: 'Subcuenta desactivada',
    message: `QLC desactivó la subcuenta/API ${subaccount.identifier || `#${subaccount.slotIndex}`} de tu cuenta. Tus estados de cuenta y pagos históricos de esa subcuenta siguen disponibles para consulta.`,
    type: 'info',
    templateKey: 'subaccount_deactivated',
    templateParams: { apiSubaccountId },
  });

  return deactivated;
}

// Reactivación directa (siempre por el admin, nunca por solicitud del
// cliente — igual que en la interfaz, "activar" es un botón administrativo
// simétrico a "desactivar"). Vuelve a contar contra el límite de 20, así
// que se revalida para no burlar el máximo desactivando y reactivando.
async function activateSubaccount({ clientId, apiSubaccountId, activatedByUserId }) {
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (!subaccount.deactivatedAt) throw ApiError.conflict('Esta subcuenta ya está activa.');

  if (!subaccount.isPrincipal) {
    const activeCount = await countActiveSubaccounts(clientId);
    if (activeCount >= MAX_SUBACCOUNTS_PER_CLIENT) {
      throw ApiError.conflict(
        `No se puede activar: este cliente ya tiene el máximo de ${MAX_SUBACCOUNTS_PER_CLIENT} subcuentas/API activas.`
      );
    }
  }

  const activated = await prisma.apiSubaccount.update({
    where: { id: apiSubaccountId },
    data: { deactivatedAt: null, deactivatedByUserId: null, updatedByUserId: activatedByUserId },
  });

  await notifyClient(clientId, {
    title: 'Subcuenta activada',
    message: `QLC activó la subcuenta/API ${subaccount.identifier || `#${subaccount.slotIndex}`}. Ya puedes verla en tu panel.`,
    type: 'success',
    templateKey: 'subaccount_activated',
    templateParams: { apiSubaccountId },
  });

  return activated;
}

module.exports = {
  requestCreateSubaccount,
  requestDeactivateSubaccount,
  listRequestsForClient,
  listRequestsForAdmin,
  approveCreateRequest,
  approveDeactivateRequest,
  rejectRequest,
  deactivateSubaccount,
  activateSubaccount,
};
