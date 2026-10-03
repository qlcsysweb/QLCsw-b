const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const driveStorage = require('../services/driveStorageService');
const { EVIDENCE_MIME } = require('../middleware/upload');
const { matchesSignature } = require('../utils/fileSignature');
const { safeFileName } = require('../utils/supportCaseFiles');
const { logAffiliateEvent } = require('../services/affiliateService');
const { clientSubaccountLabel } = require('../utils/subaccountLabels');

/*
 * PAGO PREVIO DE LA COMISIÓN DEL AFILIADOR (por estado de cuenta).
 *
 * Si el cliente de la subcuenta tiene promotor afiliador directo, el admin
 * NO puede generar el estado de cuenta (con rentabilidad) sin antes pagarle
 * su comisión a su UID de Bitget registrado y cargar el comprobante aquí.
 * Al generar el estado de cuenta, este pago queda ligado a él y la comisión
 * del afiliador nace ya PAGADA: cliente y afiliador lo ven al mismo tiempo.
 * Un pago previo registrado por error se ANULA (nunca se borra).
 */
const PREPAY_SELECT = {
  id: true,
  amount: true,
  currency: true,
  destinationUid: true,
  reference: true,
  proofFileName: true,
  status: true,
  paidAt: true,
  createdAt: true,
};

// Afiliador directo del cliente dueño de la subcuenta + su pago previo
// vigente (registrado, no anulado y todavía sin estado de cuenta).
async function prepaymentContext(apiSubaccountId) {
  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: apiSubaccountId },
    select: {
      id: true,
      isPrincipal: true,
      slotIndex: true,
      identifier: true,
      client: {
        select: {
          referredBy: { select: { id: true, firstName: true, lastName: true, affiliateCode: true, affiliateBitgetUid: true } },
        },
      },
    },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');
  const referrer = subaccount.client.referredBy || null;
  const prepayment = referrer
    ? await prisma.affiliatePayment.findFirst({
        where: { apiSubaccountId: subaccount.id, statementId: null, status: 'PAGADO' },
        orderBy: { createdAt: 'desc' },
        select: PREPAY_SELECT,
      })
    : null;
  return { subaccount, referrer, prepayment };
}

const shapeContext = ({ referrer, prepayment }) => ({
  referrer: referrer
    ? {
        id: referrer.id,
        name: `${referrer.firstName} ${referrer.lastName}`,
        affiliateCode: referrer.affiliateCode,
        bitgetUid: referrer.affiliateBitgetUid || null,
      }
    : null,
  prepayment: prepayment ? { ...prepayment, amount: Number(prepayment.amount) } : null,
});

const getPrepayment = asyncHandler(async (req, res) => {
  res.json({ ok: true, ...shapeContext(await prepaymentContext(req.params.id)) });
});

// Igual que la confirmación de transferencia del cliente: N.º de orden de
// Bitget + fecha y hora del depósito + comprobante.
const createSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: 'Indica el monto pagado al afiliador.' }).positive('El monto pagado debe ser mayor que 0.'),
  reference: z
    .string({ required_error: 'El número de orden es obligatorio' })
    .trim()
    .min(4, 'El número de orden es obligatorio')
    .max(64, 'El número de orden no puede superar 64 caracteres')
    .regex(/^[A-Za-z0-9-]+$/, 'El número de orden solo puede contener letras, números y guiones'),
  paidAt: z.coerce.date({ required_error: 'Indica la fecha y hora del depósito.', invalid_type_error: 'La fecha y hora del depósito no es válida.' }),
});

const createPrepayment = asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  // Tolerancia de 10 min por diferencia de relojes; nunca una fecha futura.
  if (data.paidAt.getTime() > Date.now() + 10 * 60 * 1000) {
    throw ApiError.badRequest('La fecha y hora del depósito no puede estar en el futuro.');
  }
  const { subaccount, referrer, prepayment } = await prepaymentContext(req.params.id);
  if (!referrer) throw ApiError.badRequest('El cliente de esta subcuenta no tiene promotor afiliador directo.');
  if (!referrer.affiliateBitgetUid) {
    throw ApiError.badRequest('El promotor afiliador todavía no registró su UID de Bitget: no hay a dónde pagarle su comisión.');
  }
  if (prepayment) throw ApiError.conflict('Ya hay un pago registrado pendiente de usarse en el estado de cuenta. Anúlalo si fue un error.');

  // Comprobante OBLIGATORIO (captura o PDF, firma real verificada).
  const file = req.file || null;
  if (!file) throw ApiError.badRequest('Carga el comprobante del pago (captura o PDF) para continuar.');
  if (!EVIDENCE_MIME.includes(file.mimetype) || !matchesSignature(file)) {
    throw ApiError.badRequest('El comprobante debe ser una imagen (JPG, PNG, WEBP) o un PDF válido.');
  }
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con Google Drive para guardar el comprobante.');
  }
  const referrerProfile = await prisma.clientProfile.findUnique({ where: { id: referrer.id } });
  const folderId = await driveStorage.getOrCreateSubfolder(referrerProfile, 'payments');
  const fileName = safeFileName(`Pago_comision_afiliado_${new Date().toISOString().slice(0, 10)}_${file.originalname}`);
  const uploaded = await driveStorage.uploadFileToDrive(file.buffer, { folderId, fileName, mimeType: file.mimetype });

  let payment;
  try {
    const now = data.paidAt;
    payment = await prisma.affiliatePayment.create({
      data: {
        referrerClientId: referrer.id,
        apiSubaccountId: subaccount.id,
        amount: Math.round(data.amount * 100) / 100,
        periodLabel: `Estado de cuenta — ${clientSubaccountLabel(subaccount) || 'subcuenta'}`,
        destinationUid: referrer.affiliateBitgetUid,
        reference: data.reference,
        proofDriveFileId: uploaded.id,
        proofFileName: fileName,
        proofMimeType: file.mimetype,
        status: 'PAGADO',
        statusUpdatedAt: now,
        paidAt: now,
        createdByUserId: req.user.id,
      },
      select: PREPAY_SELECT,
    });
  } catch (err) {
    await driveStorage.deleteDriveFileOnlyWhenAuthorized(uploaded.id, { authorized: true }).catch(() => {});
    throw err;
  }
  await logAffiliateEvent(prisma, {
    action: 'COMMISSION_PREPAYMENT_REGISTERED',
    clientId: referrer.id,
    actorUserId: req.user.id,
    details: { paymentId: payment.id, apiSubaccountId: subaccount.id, amount: Number(payment.amount), destinationUid: referrer.affiliateBitgetUid },
  });
  res.status(201).json({ ok: true, ...shapeContext({ referrer, prepayment: payment }) });
});

const voidSchema = z.object({ reason: z.string().trim().min(5, 'Indica el motivo de la anulación (mínimo 5 caracteres).').max(300) });

// ANULAR un pago previo todavía no usado (nunca se borra: queda RECHAZADO con motivo).
const voidPrepayment = asyncHandler(async (req, res) => {
  const { reason } = voidSchema.parse(req.body);
  const payment = await prisma.affiliatePayment.findUnique({ where: { id: req.params.paymentId } });
  if (!payment || !payment.apiSubaccountId) throw ApiError.notFound('Pago no encontrado');
  const { count } = await prisma.affiliatePayment.updateMany({
    where: { id: payment.id, statementId: null, status: 'PAGADO' },
    data: { status: 'RECHAZADO', statusUpdatedAt: new Date(), voidReason: reason },
  });
  if (!count) throw ApiError.conflict('Este pago ya se usó en un estado de cuenta o ya fue anulado.');
  await logAffiliateEvent(prisma, {
    action: 'COMMISSION_PREPAYMENT_VOIDED',
    clientId: payment.referrerClientId,
    actorUserId: req.user.id,
    details: { paymentId: payment.id, reason },
  });
  res.json({ ok: true });
});

module.exports = { getPrepayment, createPrepayment, voidPrepayment, prepaymentContext };
