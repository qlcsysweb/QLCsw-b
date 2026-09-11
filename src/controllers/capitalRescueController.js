const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const documentStorage = require('../services/documentStorage');
const { notifyClient } = require('../utils/notify');
const { generateCapitalRescuePdf } = require('../utils/pdf/capitalRescuePdf');
const {
  computeRescueState,
  canCreateNewInvitation,
  CAPITAL_RESCUE_INCLUDE,
} = require('../utils/capitalRescueState');

// CORRECCIÓN 4 — Invitación para Capital Temporal para Rescate. A
// diferencia de "Aumento de saldo operativo", aquí el ADMIN SÍ determina la
// distribución (depósito y devolución) entre las cuentas/subcuentas reales
// del cliente — nunca nombres ficticios, nunca de otro cliente.

const listForClient = asyncHandler(async (req, res) => {
  const invitations = await prisma.capitalRescueInvitation.findMany({
    where: { clientId: req.params.clientId },
    orderBy: { createdAt: 'desc' },
    include: CAPITAL_RESCUE_INCLUDE,
  });
  const current = computeRescueState(invitations[0] || null);
  res.json({
    ok: true,
    invitations,
    currentState: current.state,
    canCreateInvitation: canCreateNewInvitation(current),
  });
});

const createInvitationSchema = z.object({
  apiSubaccountId: z.string().min(1).optional(),
  requestedAmount: z.coerce.number().positive(),
  dailyRate: z.coerce.number().positive(),
  validityDays: z.coerce.number().int().positive().default(10),
  message: z.string().optional(),
});

const createInvitation = asyncHandler(async (req, res) => {
  const data = createInvitationSchema.parse(req.body);
  const client = await prisma.clientProfile.findUnique({ where: { id: req.params.clientId } });
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  if (data.apiSubaccountId) {
    const subaccount = await prisma.apiSubaccount.findFirst({
      where: { id: data.apiSubaccountId, clientId: client.id },
    });
    if (!subaccount) throw ApiError.badRequest('Esa subcuenta/API no pertenece a este cliente.');
  }

  const lastInvitation = await prisma.capitalRescueInvitation.findFirst({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    include: CAPITAL_RESCUE_INCLUDE,
  });
  const current = computeRescueState(lastInvitation);
  if (!canCreateNewInvitation(current)) {
    throw ApiError.conflict('Este cliente ya tiene una invitación de capital temporal activa en curso.');
  }

  const expiresAt = new Date(Date.now() + data.validityDays * 24 * 60 * 60 * 1000);
  const invitation = await prisma.capitalRescueInvitation.create({
    data: {
      clientId: client.id,
      apiSubaccountId: data.apiSubaccountId || null,
      requestedAmount: data.requestedAmount,
      dailyRate: data.dailyRate,
      validityDays: data.validityDays,
      expiresAt,
      message: data.message || null,
      createdByUserId: req.user.id,
    },
  });

  await notifyClient(client.id, {
    title: 'Invitación para capital temporal para rescate',
    message: `QLC te invita a participar voluntariamente con capital temporal de hasta ${data.requestedAmount} USDT, con una remuneración diaria del ${data.dailyRate}%.`,
    type: 'info',
    templateKey: 'rescue_invitation_created',
    templateParams: { amount: String(data.requestedAmount), dailyRate: String(data.dailyRate) },
  });

  res.status(201).json({ ok: true, invitation });
});

// El admin abre la distribución (depósito) de una participación confirmada.
const startDistribution = asyncHandler(async (req, res) => {
  const participation = await prisma.capitalRescueParticipation.findUnique({
    where: { id: req.params.participationId },
    include: { invitation: true, distribution: true },
  });
  if (!participation) throw ApiError.notFound('Participación no encontrada');
  if (participation.distribution) return res.json({ ok: true, distribution: participation.distribution });
  if (participation.status !== 'EN_PROCESO') {
    throw ApiError.conflict('Esta participación ya no está en el estado inicial de procesamiento.');
  }

  const distribution = await prisma.capitalRescueDistribution.create({
    data: { participationId: participation.id },
    include: { items: true },
  });

  res.status(201).json({ ok: true, distribution });
});

const upsertItemSchema = z.object({
  apiSubaccountId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

const upsertDistributionItem = asyncHandler(async (req, res) => {
  const { apiSubaccountId, amount } = upsertItemSchema.parse(req.body);
  const distribution = await prisma.capitalRescueDistribution.findUnique({
    where: { id: req.params.distributionId },
    include: { participation: true, items: true },
  });
  if (!distribution) throw ApiError.notFound('Distribución no encontrada');
  if (distribution.publishedAt) throw ApiError.conflict('Esta distribución ya fue publicada y no puede modificarse.');

  // Ownership real: resolver el cliente vía la invitación de la participación.
  const participationWithClient = await prisma.capitalRescueParticipation.findUnique({
    where: { id: distribution.participationId },
    include: { invitation: true },
  });
  const ownedSubaccount = await prisma.apiSubaccount.findFirst({
    where: { id: apiSubaccountId, clientId: participationWithClient.invitation.clientId },
  });
  if (!ownedSubaccount) throw ApiError.badRequest('Esa subcuenta/API no pertenece a este cliente.');

  const otherItemsTotal = distribution.items
    .filter((i) => i.apiSubaccountId !== apiSubaccountId)
    .reduce((sum, i) => sum + Number(i.amount), 0);
  if (otherItemsTotal + amount > Number(participationWithClient.participationAmount) + 0.000001) {
    throw ApiError.conflict('El monto distribuido no puede superar el monto de participación confirmado.');
  }

  const existing = distribution.items.find((i) => i.apiSubaccountId === apiSubaccountId);
  const item = existing
    ? await prisma.capitalRescueDistributionItem.update({ where: { id: existing.id }, data: { amount } })
    : await prisma.capitalRescueDistributionItem.create({
        data: { distributionId: distribution.id, apiSubaccountId, amount, order: distribution.items.length },
      });

  res.status(existing ? 200 : 201).json({ ok: true, item });
});

const removeDistributionItem = asyncHandler(async (req, res) => {
  const item = await prisma.capitalRescueDistributionItem.findUnique({
    where: { id: req.params.itemId },
    include: { distribution: true },
  });
  if (!item) throw ApiError.notFound('Elemento no encontrado');
  if (item.distribution.publishedAt) throw ApiError.conflict('Esta distribución ya fue publicada y no puede modificarse.');

  await prisma.capitalRescueDistributionItem.delete({ where: { id: item.id } });
  res.json({ ok: true });
});

const publishDistribution = asyncHandler(async (req, res) => {
  const distribution = await prisma.capitalRescueDistribution.findUnique({
    where: { id: req.params.distributionId },
    include: { items: true, participation: { include: { invitation: true } } },
  });
  if (!distribution) throw ApiError.notFound('Distribución no encontrada');
  if (distribution.publishedAt) throw ApiError.conflict('Esta distribución ya fue publicada.');

  const distributedTotal = distribution.items.reduce((sum, i) => sum + Number(i.amount), 0);
  const participationAmount = Number(distribution.participation.participationAmount);
  if (Math.abs(distributedTotal - participationAmount) > 0.000001) {
    throw ApiError.conflict(
      `El total distribuido (${distributedTotal}) debe ser exactamente igual al monto de participación (${participationAmount}) antes de publicar.`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.capitalRescueDistribution.update({ where: { id: distribution.id }, data: { publishedAt: new Date() } });
    await tx.capitalRescueParticipation.update({
      where: { id: distribution.participationId },
      data: { status: 'PENDIENTE_DE_DEPOSITO' },
    });
  });

  await notifyClient(distribution.participation.invitation.clientId, {
    title: 'Instrucciones de depósito disponibles',
    message: 'QLC publicó las instrucciones de depósito para tu participación de capital temporal para rescate. Revísalas en tu portal.',
    type: 'info',
    templateKey: 'rescue_deposit_instructions',
    templateParams: {},
  });

  res.json({ ok: true });
});

// Admin confirma que el depósito fue realizado según las instrucciones —
// inicia CAPITAL EN UTILIZACIÓN.
const confirmDeposit = asyncHandler(async (req, res) => {
  const participation = await prisma.capitalRescueParticipation.findUnique({
    where: { id: req.params.participationId },
    include: { invitation: true },
  });
  if (!participation) throw ApiError.notFound('Participación no encontrada');
  if (participation.status !== 'PENDIENTE_DE_DEPOSITO') {
    throw ApiError.conflict('Esta participación no está pendiente de depósito.');
  }

  const updated = await prisma.capitalRescueParticipation.update({
    where: { id: participation.id },
    data: { status: 'EN_UTILIZACION', depositConfirmedAt: new Date() },
  });

  await notifyClient(participation.invitation.clientId, {
    title: 'Capital en utilización',
    message: 'QLC confirmó la recepción de tu depósito de capital temporal. Tu participación ya está en utilización.',
    type: 'info',
    templateKey: 'rescue_deposit_confirmed',
    templateParams: {},
  });

  res.json({ ok: true, participation: updated });
});

// Admin finaliza el rescate — el capital queda disponible para devolución
// (mismas cuentas/montos del depósito).
const finalizeRescue = asyncHandler(async (req, res) => {
  const participation = await prisma.capitalRescueParticipation.findUnique({
    where: { id: req.params.participationId },
    include: { invitation: true },
  });
  if (!participation) throw ApiError.notFound('Participación no encontrada');
  if (participation.status !== 'EN_UTILIZACION') {
    throw ApiError.conflict('Esta participación no está en utilización.');
  }

  const updated = await prisma.capitalRescueParticipation.update({
    where: { id: participation.id },
    data: { status: 'DISPONIBLE_PARA_DEVOLUCION', usageEndedAt: new Date() },
  });

  await notifyClient(participation.invitation.clientId, {
    title: 'Capital disponible para devolución',
    message: 'El proceso de rescate finalizó. Consulta en tu portal las instrucciones para el retiro de tu capital.',
    type: 'info',
    templateKey: 'rescue_available_for_return',
    templateParams: {},
  });

  res.json({ ok: true, participation: updated });
});

// Admin registra la transferencia de remuneración (siempre independiente
// del capital principal) y cierra el ciclo — genera el Estado de Cuenta /
// Comprobante de Operación (PDF real, Google Drive).
const registerRemunerationSchema = z.object({
  remunerationAmount: z.coerce.number().nonnegative(),
  remunerationWallet: z.string().min(1),
  remunerationTxHash: z.string().min(1),
});

const registerRemuneration = asyncHandler(async (req, res) => {
  const data = registerRemunerationSchema.parse(req.body);
  const participation = await prisma.capitalRescueParticipation.findUnique({
    where: { id: req.params.participationId },
    include: {
      invitation: { include: { client: { include: { user: { select: { email: true } } } } } },
      distribution: { include: { items: { include: { apiSubaccount: true } } } },
    },
  });
  if (!participation) throw ApiError.notFound('Participación no encontrada');
  if (participation.status !== 'DISPONIBLE_PARA_DEVOLUCION') {
    throw ApiError.conflict('Esta participación todavía no está disponible para devolución.');
  }

  let updated = await prisma.capitalRescueParticipation.update({
    where: { id: participation.id },
    data: {
      remunerationAmount: data.remunerationAmount,
      remunerationWallet: data.remunerationWallet,
      remunerationTxHash: data.remunerationTxHash,
      remunerationPaidAt: new Date(),
      status: 'FINALIZADA',
      finalizedAt: new Date(),
    },
    include: { distribution: { include: { items: { include: { apiSubaccount: true } } } } },
  });

  if (await documentStorage.isConfigured()) {
    try {
      const pdfBuffer = await generateCapitalRescuePdf({
        client: participation.invitation.client,
        invitation: participation.invitation,
        participation: updated,
      });
      const { documentsFolderId } = await documentStorage.ensureClientFolders(participation.invitation.client);
      const fileName = `Comprobante_Capital_Rescate_${participation.invitation.client.firstName}_${participation.invitation.client.lastName}_${Date.now()}.pdf`.replace(
        /\s+/g,
        '_'
      );
      const uploaded = await documentStorage.uploadDocument(pdfBuffer, {
        folderId: documentsFolderId,
        fileName,
        mimeType: 'application/pdf',
      });
      updated = await prisma.capitalRescueParticipation.update({
        where: { id: participation.id },
        data: {
          comprobantePdfDriveFileId: uploaded.id,
          comprobantePdfDriveFolderId: documentsFolderId,
          comprobantePdfFileName: fileName,
        },
      });
    } catch {
      // El cierre queda registrado igual aunque el PDF falle — el admin
      // puede reintentar la generación más adelante si fuera necesario.
    }
  }

  await notifyClient(participation.invitation.clientId, {
    title: 'Operación finalizada — remuneración pagada',
    message: `QLC transfirió tu remuneración de ${data.remunerationAmount} USDT. La operación de capital temporal para rescate ha finalizado.`,
    type: 'success',
    templateKey: 'rescue_finalized',
    templateParams: { amount: String(data.remunerationAmount) },
  });

  res.json({ ok: true, participation: updated });
});

const downloadComprobante = asyncHandler(async (req, res) => {
  const participation = await prisma.capitalRescueParticipation.findUnique({ where: { id: req.params.id } });
  if (!participation) throw ApiError.notFound('Participación no encontrada');
  if (!participation.comprobantePdfDriveFileId) throw ApiError.notFound('El comprobante todavía no está disponible');

  const { stream, fileName, mimeType } = await documentStorage.downloadDocument(participation.comprobantePdfDriveFileId);
  res.setHeader('Content-Type', mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || participation.comprobantePdfFileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = {
  listForClient,
  createInvitation,
  startDistribution,
  upsertDistributionItem,
  removeDistributionItem,
  publishDistribution,
  confirmDeposit,
  finalizeRescue,
  registerRemuneration,
  downloadComprobante,
};
