/*
 * GESTIÓN DINÁMICA DE SUBCUENTAS/API — punto único de la lógica de
 * solicitudes de creación/eliminación de subcuenta, para que el
 * controlador de cliente y el de admin nunca puedan divergir en las
 * validaciones (límite de 20, estados de cuenta pendientes, duplicados).
 */
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { notifyAdmins, notifyClient } = require('../utils/notify');
const {
  ensurePrincipalSubaccount: _ensurePrincipalSubaccount,
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

async function requestDeleteSubaccount({ clientId, apiSubaccountId, reason, requestedByUserId }) {
  const client = await prisma.clientProfile.findUnique({ where: { id: clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: apiSubaccountId, clientId },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (subaccount.isPrincipal) throw ApiError.badRequest('La cuenta PRINCIPAL no puede eliminarse.');
  if (subaccount.removedAt) throw ApiError.conflict('Esta subcuenta ya fue eliminada.');

  const duplicate = await prisma.subaccountRequest.findFirst({
    where: { apiSubaccountId, type: 'DELETE', status: 'PENDING' },
  });
  if (duplicate) {
    throw ApiError.conflict('Ya existe una solicitud de eliminación pendiente para esta subcuenta.');
  }

  if (await hasPendingStatements(apiSubaccountId)) {
    throw ApiError.conflict(
      'Esta subcuenta tiene un estado de cuenta con comisión pendiente de pago. Debes liquidarlo antes de solicitar su eliminación.'
    );
  }

  const request = await prisma.subaccountRequest.create({
    data: { clientId, type: 'DELETE', apiSubaccountId, reason: reason || null, requestedByUserId },
  });

  await notifyAdmins({
    title: 'Solicitud de eliminación de subcuenta',
    message: `${clientDisplayName(client)} solicitó eliminar la subcuenta/API ${subaccount.identifier || `#${subaccount.slotIndex}`}${reason ? `. Motivo: ${reason}` : '.'}`,
    type: 'warning',
    templateKey: 'subaccount_delete_request_created_admin',
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

async function approveDeleteRequest({ requestId, reviewedByUserId }) {
  const request = await getPendingRequestOrThrow(requestId, 'DELETE');
  return removeSubaccount({
    clientId: request.clientId,
    apiSubaccountId: request.apiSubaccountId,
    removedByUserId: reviewedByUserId,
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

  const isDelete = request.type === 'DELETE';
  await notifyClient(request.clientId, {
    title: isDelete ? 'Solicitud de eliminación rechazada' : 'Solicitud de nueva subcuenta rechazada',
    message: isDelete
      ? `QLC revisó tu solicitud de eliminar la subcuenta/API ${request.apiSubaccount?.identifier || `#${request.apiSubaccount?.slotIndex}`} y, por ahora, no fue posible autorizarla.${reviewNote ? ` Motivo: ${reviewNote}` : ''}`
      : `QLC revisó tu solicitud de subcuenta adicional y, por ahora, no fue posible habilitarla.${reviewNote ? ` Motivo: ${reviewNote}` : ''}`,
    type: 'warning',
    templateKey: isDelete ? 'subaccount_delete_request_rejected' : 'subaccount_request_rejected',
    templateParams: { apiSubaccountId: request.apiSubaccountId },
  });

  return updated;
}

// Núcleo compartido de "eliminar" (soft-delete): usado tanto al aprobar una
// solicitud del cliente como al eliminar directamente desde el panel admin.
// Nunca borra la fila — solo marca removedAt/removedByUserId, así que
// estados de cuenta, pagos, documentos y notificaciones históricas quedan
// intactos y consultables (ver ApiSubaccount.removedAt en el schema).
async function removeSubaccount({ clientId, apiSubaccountId, removedByUserId, reviewNote, linkedRequestId }) {
  // Vuelve a cargar la subcuenta con el clientId como parte del WHERE —
  // esta es la defensa real contra IDOR: un id manipulado que pertenezca a
  // OTRO cliente simplemente no calza con este filtro y produce 404, nunca
  // elimina una subcuenta ajena.
  const subaccount = await prisma.apiSubaccount.findFirst({ where: { id: apiSubaccountId, clientId } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  if (subaccount.isPrincipal) throw ApiError.badRequest('La cuenta PRINCIPAL no puede eliminarse.');
  if (subaccount.removedAt) throw ApiError.conflict('Esta subcuenta ya fue eliminada.');
  if (await hasPendingStatements(apiSubaccountId)) {
    throw ApiError.conflict(
      'Esta subcuenta tiene un estado de cuenta con comisión pendiente de pago. No puede eliminarse hasta que se liquide.'
    );
  }

  const removed = await prisma.apiSubaccount.update({
    where: { id: apiSubaccountId },
    data: { removedAt: new Date(), removedByUserId },
  });

  if (linkedRequestId) {
    await prisma.subaccountRequest.update({
      where: { id: linkedRequestId },
      data: { status: 'APPROVED', reviewedByUserId: removedByUserId, reviewedAt: new Date() },
    });
  } else {
    // Eliminación directa desde el panel admin, sin una solicitud previa del
    // cliente — se registra igual como una solicitud ya resuelta, para que
    // el historial de acciones sobre esta subcuenta quede completo en un
    // solo lugar (AUDITORÍA §4/§9: fecha, usuario, estado).
    await prisma.subaccountRequest.create({
      data: {
        clientId,
        type: 'DELETE',
        apiSubaccountId,
        status: 'APPROVED',
        reviewNote: reviewNote || 'Eliminada directamente por un administrador desde el panel.',
        requestedByUserId: removedByUserId,
        reviewedByUserId: removedByUserId,
        reviewedAt: new Date(),
      },
    });
  }

  await notifyClient(clientId, {
    title: 'Subcuenta eliminada',
    message: `QLC eliminó la subcuenta/API ${subaccount.identifier || `#${subaccount.slotIndex}`} de tu cuenta. Tus estados de cuenta y pagos históricos de esa subcuenta siguen disponibles para consulta.`,
    type: 'info',
    templateKey: 'subaccount_removed',
    templateParams: { apiSubaccountId },
  });

  return removed;
}

module.exports = {
  requestCreateSubaccount,
  requestDeleteSubaccount,
  listRequestsForClient,
  listRequestsForAdmin,
  approveCreateRequest,
  approveDeleteRequest,
  rejectRequest,
  removeSubaccount,
};
