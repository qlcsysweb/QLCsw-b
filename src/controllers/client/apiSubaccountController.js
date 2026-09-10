const { z } = require('zod');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { encrypt } = require('../../utils/crypto');
const documentStorage = require('../../services/documentStorage');
const { generateContractPdf } = require('../../utils/pdf/contractPdf');
const { enforceCommissionDeadline } = require('../../utils/connectionDeadlines');

function shape(subaccount) {
  const { apiKeyEncrypted, apiSecretEncrypted, apiPassphraseEncrypted, ...rest } = subaccount;
  return {
    ...rest,
    hasApiKey: Boolean(apiKeyEncrypted),
    hasApiSecret: Boolean(apiSecretEncrypted),
    hasApiPassphrase: Boolean(apiPassphraseEncrypted),
  };
}

const listMine = asyncHandler(async (req, res) => {
  const clientId = req.clientProfile.id;
  const preCheck = await prisma.apiSubaccount.findMany({ where: { clientId }, select: { id: true } });
  await Promise.all(preCheck.map((s) => enforceCommissionDeadline(s.id)));

  const subaccounts = await prisma.apiSubaccount.findMany({
    where: { clientId },
    orderBy: { slotIndex: 'asc' },
    include: {
      clientModel: { include: { model: true } },
      process: { include: { conditions: true } },
      contract: true,
    },
  });
  res.json({ ok: true, subaccounts: subaccounts.map(shape) });
});

const getMine = asyncHandler(async (req, res) => {
  await enforceCommissionDeadline(req.params.id);
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
    include: {
      clientModel: { include: { model: true } },
      process: { include: { conditions: true } },
      contract: true,
      paymentReports: { orderBy: { reportedAt: 'desc' } },
      statements: { orderBy: { createdAt: 'desc' } },
      connectionEvents: { orderBy: { occurredAt: 'desc' } },
      capitalDistributionItems: true,
    },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  res.json({ ok: true, subaccount: shape(subaccount) });
});

const updateSchema = z.object({
  exchangeName: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
  apiPassphrase: z.string().min(1).optional(),
});

// El cliente NUNCA puede fijar su propio "status" (CORRECCIÓN 10): eso es
// exclusivamente administrativo/visual, tras revisión manual del equipo.
const updateMine = asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  if (!data.exchangeName && !data.apiKey && !data.apiSecret && !data.apiPassphrase) {
    throw ApiError.badRequest('Debes indicar al menos un dato para actualizar');
  }

  const existing = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');

  const updated = await prisma.apiSubaccount.update({
    where: { id: existing.id },
    data: {
      ...(data.exchangeName ? { exchangeName: data.exchangeName } : {}),
      ...(data.apiKey ? { apiKeyEncrypted: encrypt(data.apiKey) } : {}),
      ...(data.apiSecret ? { apiSecretEncrypted: encrypt(data.apiSecret) } : {}),
      ...(data.apiPassphrase ? { apiPassphraseEncrypted: encrypt(data.apiPassphrase) } : {}),
      updatedByUserId: req.user.id,
    },
  });

  res.json({ ok: true, subaccount: shape(updated) });
});

// CORRECCIÓN 10: el cliente solo puede INFORMAR que ya tiene el capital
// operativo requerido — la validación real siempre es manual, vía la
// plataforma externa de QLC.
const reportCapitalReady = asyncHandler(async (req, res) => {
  const existing = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!existing) throw ApiError.notFound('Subcuenta no encontrada');

  const updated = await prisma.apiSubaccount.update({
    where: { id: existing.id },
    data: { clientReportedCapitalReady: true, clientReportedCapitalAt: new Date() },
  });

  const process = await prisma.process.findUnique({ where: { apiSubaccountId: existing.id } });
  if (process) {
    await prisma.processCondition.updateMany({
      where: { processId: process.id, type: 'FUNDS' },
      data: { status: 'CONFIRMED' },
    });
  }

  res.json({ ok: true, subaccount: shape(updated) });
});

const selectModelSchema = z.object({ modelId: z.string().min(1) });

const selectModel = asyncHandler(async (req, res) => {
  const { modelId } = selectModelSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const model = await prisma.model.findUnique({ where: { id: modelId } });
  if (!model || !model.isActive) throw ApiError.badRequest('Modelo no válido');

  const existing = await prisma.clientModel.findUnique({ where: { apiSubaccountId: subaccount.id } });
  if (existing?.confirmedAt) {
    throw ApiError.conflict('Ya confirmaste un modelo para esta subcuenta. Contacta con QLC para cambiarlo.');
  }

  const clientModel = await prisma.clientModel.upsert({
    where: { apiSubaccountId: subaccount.id },
    update: { modelId: model.id },
    create: { apiSubaccountId: subaccount.id, modelId: model.id },
    include: { model: true },
  });

  res.json({ ok: true, clientModel });
});

// CORRECCIÓN 23: al confirmar el modelo se genera el contrato (PDF con los
// datos reales del cliente y del modelo) y queda disponible para que el
// cliente lo descargue, imprima, firme y vuelva a subirlo firmado.
const confirmModel = asyncHandler(async (req, res) => {
  const subaccount = await prisma.apiSubaccount.findFirst({
    where: { id: req.params.id, clientId: req.clientProfile.id },
    include: {
      client: {
        include: { user: { select: { email: true } } },
      },
    },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  const clientModel = await prisma.clientModel.findUnique({
    where: { apiSubaccountId: subaccount.id },
    include: { model: true },
  });
  if (!clientModel) throw ApiError.badRequest('Todavía no has seleccionado un modelo.');
  if (clientModel.confirmedAt) throw ApiError.conflict('Ya confirmaste este modelo.');

  const confirmed = await prisma.clientModel.update({
    where: { id: clientModel.id },
    data: { confirmedAt: new Date() },
    include: { model: true },
  });

  let contract = await prisma.contract.findUnique({ where: { apiSubaccountId: subaccount.id } });

  if (await documentStorage.isConfigured()) {
    try {
      // CORRECCIÓN 4: nacionalidad y wallet del cliente ya están capturadas
      // desde el registro — nunca se le vuelven a pedir aquí. La wallet de
      // depósito de QLC se lee de la configuración ya existente del admin.
      const paymentConfig = await prisma.paymentConfiguration.findFirst();
      const pdfBuffer = await generateContractPdf({
        client: subaccount.client,
        model: confirmed.model,
        identifier: subaccount.identifier,
        qlcWallet: paymentConfig
          ? { address: paymentConfig.walletAddress, network: paymentConfig.network, currency: paymentConfig.currency }
          : null,
      });
      const { contractsFolderId } = await documentStorage.ensureClientFolders(subaccount.client);
      const fileName = `Contrato_${subaccount.client.firstName}_${subaccount.client.lastName}.pdf`.replace(/\s+/g, '_');

      if (contract?.originalDriveFileId) {
        await documentStorage.deleteDocument(contract.originalDriveFileId).catch(() => {});
      }

      const uploaded = await documentStorage.uploadDocument(pdfBuffer, {
        folderId: contractsFolderId,
        fileName,
        mimeType: 'application/pdf',
      });

      const contractData = {
        status: 'UPLOADED',
        originalDriveFileId: uploaded.id,
        originalDriveFolderId: contractsFolderId,
        originalFileName: fileName,
        originalMimeType: 'application/pdf',
        uploadedAt: new Date(),
        generatedAt: new Date(),
      };

      contract = contract
        ? await prisma.contract.update({ where: { id: contract.id }, data: contractData })
        : await prisma.contract.create({ data: { apiSubaccountId: subaccount.id, ...contractData } });
    } catch {
      // Si Drive falla puntualmente, el modelo queda confirmado igual — el
      // administrador puede subir el contrato manualmente como respaldo.
    }
  }

  res.json({ ok: true, clientModel: confirmed, contract });
});

module.exports = { listMine, getMine, updateMine, reportCapitalReady, selectModel, confirmModel };
