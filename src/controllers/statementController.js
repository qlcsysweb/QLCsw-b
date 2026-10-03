const { z } = require('zod');
const { clientSubaccountLabel } = require('../utils/subaccountLabels');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const driveStorage = require('../services/driveStorageService');
const { generateStatementPdf } = require('../utils/pdf/statementPdf');
const { notifyClient } = require('../utils/notify');
const { assertSafeFiles } = require('../utils/fileSignature');
const { safeFileName } = require('../utils/supportCaseFiles');
const { getEffectiveConfig, computeDistribution, logAffiliateEvent } = require('../services/affiliateService');

// Lazy para evitar dependencia circular de módulos.
async function getPrepaymentInfo(apiSubaccountId) {
  const { prepaymentContext } = require('./affiliatePrepaymentController');
  const { referrer, prepayment } = await prepaymentContext(apiSubaccountId);
  return {
    referrer: referrer ? { id: referrer.id, name: `${referrer.firstName} ${referrer.lastName}`, affiliateCode: referrer.affiliateCode, bitgetUid: referrer.affiliateBitgetUid || null } : null,
    prepayment: prepayment ? { ...prepayment, amount: Number(prepayment.amount) } : null,
  };
}
const {
  STATEMENT_DUE_HOURS,
  effectiveStatementStatus,
  currentStatementSummary,
  enforceCommissionDeadline,
} = require('../utils/connectionDeadlines');

function monthLabel(date) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', month: 'long', year: 'numeric' }).format(
    date instanceof Date ? date : new Date(date)
  );
}

/*
 * ESTADO DE CUENTA SIMPLIFICADO — uno por SUBCUENTA/API. El admin lo genera
 * desde la propia subcuenta ("Generar"): NO GENERADO → PENDIENTE DE PAGO y
 * arranca el plazo de 72 h (expiresAt calculado aquí, nunca en frontend).
 * La comunicación al cliente es la mensajería interna + correo del propio
 * sistema de notificaciones — no existe un flujo de "envío" separado.
 */
function shapeStatement(statement) {
  return { ...statement, status: effectiveStatementStatus(statement) };
}

const listStatements = asyncHandler(async (req, res) => {
  await enforceCommissionDeadline(req.params.apiSubaccountId);
  const statements = await prisma.statement.findMany({
    where: { apiSubaccountId: req.params.apiSubaccountId },
    orderBy: { generatedAt: 'desc' },
    include: { attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: 'asc' } } },
  });
  // El BORRADOR (si existe) va aparte: no es un estado de cuenta emitido, no
  // cuenta en el historial ni en el estado actual.
  const draft = statements.find((s) => s.status === 'BORRADOR') || null;
  const issued = statements.filter((s) => s.status !== 'BORRADOR');
  // QLC AFFILIATE PROGRAM — porcentajes vigentes y si el cliente tiene
  // afiliador directo, para que el formulario muestre la distribución.
  const [config, owner] = await Promise.all([
    getEffectiveConfig(),
    prisma.apiSubaccount.findUnique({ where: { id: req.params.apiSubaccountId }, select: { client: { select: { referredByClientId: true } } } }),
  ]);
  res.json({
    ok: true,
    statements: issued.map(shapeStatement),
    draft,
    current: currentStatementSummary(issued),
    distribution: {
      clientSharePct: Number(config.clientSharePct),
      qlcSharePct: Number(config.qlcSharePct),
      affiliateSharePct: Number(config.affiliateSharePct),
      hasReferrer: Boolean(owner?.client?.referredByClientId),
    },
    // Paso obligatorio previo: promotor afiliador (nombre, UID) y su pago registrado.
    affiliatePrepayment: owner?.client?.referredByClientId ? await getPrepaymentInfo(req.params.apiSubaccountId) : null,
  });
});

const createStatementSchema = z
  .object({
    // "DESDE" se autocompleta desde el periodo anterior de la MISMA
    // subcuenta/API; solo es obligatorio para el primer estado de cuenta.
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date(),
    startingBalance: z.coerce.number(),
    endingBalance: z.coerce.number(),
    resultAmount: z.coerce.number(),
    resultPercentage: z.coerce.number(),
    volatility: z.string().optional(),
    netResult: z.coerce.number().optional(),
    commission: z.coerce.number().min(0).default(0),
    // Comisión del AFILIADOR directo del periodo (USDT). El formulario la
    // propone con el % vigente; el admin puede ajustarla. Vacía = % vigente.
    affiliateCommission: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(0, 'La comisión del afiliador no puede ser negativa.').optional()),
    activityNotes: z.string().optional(),
    adminNotes: z.string().optional(),
  })
  .refine((data) => !data.periodStart || data.periodEnd > data.periodStart, {
    message: 'El periodo "hasta" debe ser posterior al periodo "desde".',
    path: ['periodEnd'],
  });

// BORRADOR — el admin puede guardar el estado de cuenta incompleto: solo el
// periodo es obligatorio (columnas NOT NULL); los importes que falten se
// guardan en 0 y se exigen completos al FINALIZAR (createStatementSchema).
const optionalNumber = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().optional());
const draftStatementSchema = z
  .object({
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date({ required_error: 'Indica la fecha "hasta" del periodo.' }),
    startingBalance: optionalNumber,
    endingBalance: optionalNumber,
    resultAmount: optionalNumber,
    resultPercentage: optionalNumber,
    volatility: z.string().optional(),
    netResult: optionalNumber,
    commission: optionalNumber,
    affiliateCommission: optionalNumber,
    activityNotes: z.string().optional(),
    adminNotes: z.string().optional(),
  })
  .refine((data) => !data.periodStart || data.periodEnd > data.periodStart, {
    message: 'El periodo "hasta" debe ser posterior al periodo "desde".',
    path: ['periodEnd'],
  });

// Serializa las escrituras de estados de cuenta de UNA subcuenta dentro de
// la transacción: dos "Guardar borrador" / "Generar" casi simultáneos nunca
// crean dos registros. Se libera al terminar la transacción.
function lockStatementSubaccount(tx, apiSubaccountId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`statement:${apiSubaccountId}`}))`;
}

// "Desde" = fin del último estado de cuenta EMITIDO (los borradores no
// cuentan); solo el primero de la subcuenta lo indica el admin.
async function resolvePeriodStart(tx, apiSubaccountId, requestedStart, periodEnd) {
  const previous = await tx.statement.findFirst({
    where: { apiSubaccountId, status: { not: 'BORRADOR' } },
    orderBy: { periodEnd: 'desc' },
  });
  const periodStart = previous ? previous.periodEnd : requestedStart;
  if (!periodStart) {
    throw ApiError.badRequest('Indica la fecha "desde" para el primer estado de cuenta de esta subcuenta/API.');
  }
  if (periodEnd <= periodStart) {
    throw ApiError.badRequest('El periodo "hasta" debe ser posterior al periodo "desde".');
  }
  return periodStart;
}

function statementFields(data, periodStart) {
  return {
    periodStart,
    periodEnd: data.periodEnd,
    startingBalance: data.startingBalance ?? 0,
    endingBalance: data.endingBalance ?? 0,
    resultAmount: data.resultAmount ?? 0,
    resultPercentage: data.resultPercentage ?? 0,
    volatility: data.volatility || null,
    netResult: data.netResult ?? null,
    commission: data.commission ?? 0,
    // En un borrador se conserva lo capturado; al emitir lo reemplaza la distribución final.
    affiliateCommissionAmount: data.affiliateCommission ?? null,
    activityNotes: data.activityNotes || null,
    adminNotes: data.adminNotes || null,
  };
}

function periodConflict(err) {
  if (err.code === 'P2002') {
    return ApiError.conflict('Ya existe un estado de cuenta para esta subcuenta/API en ese mismo periodo.');
  }
  return err;
}

// GUARDAR BORRADOR — un único borrador por subcuenta (además lo garantiza el
// índice único parcial statements_one_draft_per_subaccount): si ya existe se
// ACTUALIZA, nunca se inserta otro. Sin PDF, sin plazo de 72 h, sin
// notificación y sin Drive: el cliente no lo ve.
const saveStatementDraft = asyncHandler(async (req, res) => {
  const data = draftStatementSchema.parse(req.body);
  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: req.params.apiSubaccountId }, select: { id: true } });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  let draft;
  try {
    draft = await prisma.$transaction(async (tx) => {
      await lockStatementSubaccount(tx, subaccount.id);
      const periodStart = await resolvePeriodStart(tx, subaccount.id, data.periodStart, data.periodEnd);
      const existing = await tx.statement.findFirst({ where: { apiSubaccountId: subaccount.id, status: 'BORRADOR' } });
      // generatedAt/expiresAt son obligatorios en la tabla: en un borrador
      // solo registran el último guardado (el plazo real nace al finalizar).
      const now = new Date();
      const fields = { ...statementFields(data, periodStart), generatedAt: now, expiresAt: now };
      if (existing) return tx.statement.update({ where: { id: existing.id }, data: fields });
      return tx.statement.create({
        data: { ...fields, apiSubaccountId: subaccount.id, status: 'BORRADOR', createdByUserId: req.user.id },
      });
    });
  } catch (err) {
    throw periodConflict(err);
  }
  res.json({ ok: true, draft });
});

// ELIMINAR BORRADOR — solo un BORRADOR (nunca un estado de cuenta emitido:
// esos siguen las reglas de auditoría). No hay PDF ni archivos que limpiar.
const deleteStatementDraft = asyncHandler(async (req, res) => {
  const { count } = await prisma.statement.deleteMany({ where: { id: req.params.id, status: 'BORRADOR' } });
  if (!count) throw ApiError.conflict('Solo se puede eliminar un borrador de estado de cuenta.');
  res.json({ ok: true });
});

// GENERAR / FINALIZAR — si la subcuenta tiene un BORRADOR, ese MISMO
// registro pasa a PENDIENTE_DE_PAGO con los datos finales; si no, se crea
// directamente. Todo dentro de una transacción con bloqueo por subcuenta
// (y el índice único por periodo): un doble clic nunca genera dos estados de
// cuenta ni dos PDFs.
const createStatement = asyncHandler(async (req, res) => {
  const data = createStatementSchema.parse(req.body);
  // PDF del estado de cuenta cargado por el admin (multipart, campo "file").
  // Si viene, ES el estado de cuenta: se guarda en Drive, se adjunta al
  // correo del cliente y queda descargable en su panel. Sin archivo se
  // conserva el PDF generado automáticamente por el sistema.
  const uploadedPdf = req.file || null;
  if (uploadedPdf && !(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable(
      'No pudimos conectar con Google Drive para guardar el PDF. Ve a Configuración → Google Drive en el panel administrativo.'
    );
  }
  const subaccount = await prisma.apiSubaccount.findUnique({
    where: { id: req.params.apiSubaccountId },
    include: {
      client: { include: { user: { select: { email: true } } } },
      clientModel: { include: { model: true } },
    },
  });
  if (!subaccount) throw ApiError.notFound('Subcuenta no encontrada');

  await enforceCommissionDeadline(subaccount.id);

  // Fuente de verdad del contador: hora del servidor + 72 h.
  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + STATEMENT_DUE_HOURS * 60 * 60 * 1000);

  // QLC AFFILIATE PROGRAM — distribución de la rentabilidad generada
  // registrada en ESTE estado de cuenta (dato validado por QLC; la
  // plataforma no consulta Bitget). Beneficiario: el afiliador DIRECTO
  // permanente del cliente, leído de la relación guardada.
  // Porcentajes de la versión de configuración VIGENTE al emitir (queda
  // guardado qué versión se usó).
  const affiliateConfig = await getEffectiveConfig(new Date());
  const referrerClientId = subaccount.client.referredByClientId || null;
  const distribution = computeDistribution(data.resultAmount, affiliateConfig);
  // PAGO PREVIO OBLIGATORIO AL AFILIADOR: con afiliador directo y
  // rentabilidad positiva, el estado de cuenta solo se genera si el admin ya
  // pagó la comisión y cargó el comprobante (ver affiliatePrepaymentController).
  // La comisión del periodo es EXACTAMENTE lo pagado y nace ya PAGADA.
  const profitPositive = Number(data.resultAmount) > 0;
  let prepayment = null;
  if (referrerClientId && profitPositive) {
    prepayment = await prisma.affiliatePayment.findFirst({
      where: { apiSubaccountId: subaccount.id, statementId: null, status: 'PAGADO' },
      orderBy: { createdAt: 'desc' },
    });
    if (!prepayment) {
      throw ApiError.badRequest('Primero paga la comisión al promotor afiliador (a su UID de Bitget) y carga el comprobante; después podrás generar el estado de cuenta.');
    }
    data.affiliateCommission = Number(prepayment.amount);
  }
  // COMISIÓN DEL AFILIADOR (la pagada, o la capturada por el admin): reemplaza
  // la calculada con el % vigente y la parte de QLC se recalcula para que la
  // suma siga siendo la rentabilidad generada. Sin afiliador directo no aplica.
  if (referrerClientId && data.affiliateCommission !== undefined) {
    const profit = Number(data.resultAmount) > 0 ? Number(data.resultAmount) : 0;
    const affiliateAmount = Math.round(data.affiliateCommission * 100) / 100;
    if (affiliateAmount > Math.round((profit - distribution.clientResultAmount) * 100) / 100) {
      throw ApiError.badRequest('La comisión del afiliador no puede superar la parte disponible de la rentabilidad (rentabilidad − resultado del cliente).');
    }
    distribution.affiliateCommissionAmount = affiliateAmount;
    distribution.qlcCommissionAmount = Math.round((profit - distribution.clientResultAmount - affiliateAmount) * 100) / 100;
  }
  const distributionFields = {
    ...distribution,
    affiliateConfigVersionId: affiliateConfig.versionId,
    // Solo con afiliador directo (y rentabilidad positiva) hay comisión a pagar.
    affiliateReferrerClientId: distribution.affiliateCommissionAmount > 0 ? referrerClientId : null,
  };

  let statement;
  let fromDraft = false;
  try {
    ({ statement, fromDraft } = await prisma.$transaction(async (tx) => {
      await lockStatementSubaccount(tx, subaccount.id);
      const unpaid = await tx.statement.findFirst({
        where: { apiSubaccountId: subaccount.id, status: { in: ['PENDIENTE_DE_PAGO', 'VENCIDO_SIN_PAGAR'] } },
      });
      if (unpaid) {
        throw ApiError.conflict('Esta subcuenta/API ya tiene un estado de cuenta sin pagar. Confirma su pago antes de generar uno nuevo.');
      }
      const periodStart = await resolvePeriodStart(tx, subaccount.id, data.periodStart, data.periodEnd);
      const fields = { ...statementFields(data, periodStart), ...distributionFields, status: 'PENDIENTE_DE_PAGO', generatedAt, expiresAt };
      const draft = await tx.statement.findFirst({ where: { apiSubaccountId: subaccount.id, status: 'BORRADOR' } });
      const saved = draft
        ? await tx.statement.update({ where: { id: draft.id }, data: fields })
        : await tx.statement.create({ data: { ...fields, apiSubaccountId: subaccount.id, createdByUserId: req.user.id } });
      // Comisión del afiliador directo del periodo, en la MISMA transacción
      // (una por estado de cuenta: statementId único). Con pago previo nace
      // PAGADA y ligada a ese pago; el pago queda ligado a este estado de cuenta.
      if (prepayment) {
        const { count } = await tx.affiliatePayment.updateMany({
          where: { id: prepayment.id, statementId: null, status: 'PAGADO' },
          data: {
            statementId: saved.id,
            periodLabel: `Estado de cuenta ${periodStart.toISOString().slice(0, 10)} – ${data.periodEnd.toISOString().slice(0, 10)}`,
          },
        });
        if (!count) throw ApiError.conflict('El pago de la comisión cambió mientras se generaba el estado de cuenta. Intenta nuevamente.');
      }
      if (distributionFields.affiliateReferrerClientId) {
        await tx.affiliateCommission.create({
          data: {
            referrerClientId: distributionFields.affiliateReferrerClientId,
            referredClientId: subaccount.clientId,
            statementId: saved.id,
            concept: `Estado de cuenta ${periodStart.toISOString().slice(0, 10)} – ${data.periodEnd.toISOString().slice(0, 10)}`,
            baseAmount: data.resultAmount,
            commissionType: 'PERCENTAGE',
            commissionValue: distribution.affiliateSharePct,
            amount: distribution.affiliateCommissionAmount,
            periodStart,
            periodEnd: data.periodEnd,
            configVersionId: affiliateConfig.versionId,
            occurredAt: generatedAt,
            ...(prepayment
              ? { status: 'PAGADA', approvedAt: generatedAt, approvedByUserId: req.user.id, paidAt: prepayment.paidAt || generatedAt, paidByUserId: req.user.id, paymentId: prepayment.id }
              : { status: 'PENDIENTE' }),
            createdByUserId: req.user.id,
          },
        });
      }
      return { statement: saved, fromDraft: Boolean(draft) };
    }));
  } catch (err) {
    throw periodConflict(err);
  }
  const { periodStart } = statement;

  let updatedStatement = statement;
  let pdfAttachment = null;
  // Nombre y PDF sin el identificador interno (el cliente recibe el archivo).
  const fileName = `Estado_de_cuenta_${clientSubaccountLabel(subaccount).replace(/[^A-Za-z0-9]+/g, '_') || subaccount.id}_${periodStart.toISOString().slice(0, 7)}.pdf`;
  if (uploadedPdf) {
    // El PDF del admin es obligatorio que quede guardado: si Drive falla, no
    // se deja un estado de cuenta "generado" sin su documento.
    try {
      const statementsFolderId = await driveStorage.getOrCreateSubfolder(subaccount.client, 'statements');
      const uploaded = await driveStorage.uploadFileToDrive(uploadedPdf.buffer, {
        folderId: statementsFolderId,
        fileName,
        mimeType: 'application/pdf',
      });
      updatedStatement = await prisma.statement.update({
        where: { id: statement.id },
        data: { pdfDriveFileId: uploaded.id, pdfDriveFolderId: statementsFolderId, pdfFileName: fileName },
      });
      pdfAttachment = { filename: fileName, content: uploadedPdf.buffer, contentType: 'application/pdf' };
    } catch {
      // Nunca queda un estado de cuenta "generado" sin su documento: si venía
      // de un borrador vuelve a BORRADOR (no se pierde lo capturado); si se
      // acababa de crear, se retira.
      // Sin estado de cuenta emitido no hay comisión del periodo.
      await prisma.affiliateCommission.deleteMany({ where: { statementId: statement.id } }).catch(() => {});
      // El pago previo vuelve a quedar disponible para el siguiente intento.
      await prisma.affiliatePayment.updateMany({ where: { statementId: statement.id }, data: { statementId: null } }).catch(() => {});
      if (fromDraft) {
        await prisma.statement.update({ where: { id: statement.id }, data: { status: 'BORRADOR' } }).catch(() => {});
      } else {
        await prisma.statement.delete({ where: { id: statement.id } }).catch(() => {});
      }
      throw ApiError.serviceUnavailable('No se pudo guardar el PDF del estado de cuenta en Google Drive. Intenta nuevamente.');
    }
  } else if (await driveStorage.isConfigured()) {
    try {
      const pdfBuffer = await generateStatementPdf({
        client: subaccount.client,
        identifier: clientSubaccountLabel(subaccount),
        model: subaccount.clientModel?.model,
        statement,
      });
      const statementsFolderId = await driveStorage.getOrCreateSubfolder(subaccount.client, 'statements');
      const uploaded = await driveStorage.uploadFileToDrive(pdfBuffer, {
        folderId: statementsFolderId,
        fileName,
        mimeType: 'application/pdf',
      });
      updatedStatement = await prisma.statement.update({
        where: { id: statement.id },
        data: { pdfDriveFileId: uploaded.id, pdfDriveFolderId: statementsFolderId, pdfFileName: fileName },
      });
      pdfAttachment = { filename: fileName, content: pdfBuffer, contentType: 'application/pdf' };
    } catch {
      // El estado de cuenta queda generado aunque el PDF automático falle.
    }
  }

  // Mensajería interna + correo (notifyClient crea la notificación y envía
  // el email al correo real del cliente en la misma acción). El PDF va
  // ADJUNTO al correo y queda descargable dentro de la subcuenta del cliente.
  const month = monthLabel(data.periodEnd);
  const identifier = clientSubaccountLabel(subaccount);
  const notification = await notifyClient(subaccount.clientId, {
    title: 'Estado de cuenta generado — pendiente de pago',
    message: `Tu estado de cuenta de ${month}${identifier ? ` (subcuenta/API ${identifier})` : ''} fue generado y está PENDIENTE DE PAGO.${pdfAttachment ? ' El PDF del estado de cuenta va adjunto a este correo y también puedes descargarlo desde tu subcuenta en el panel de QLC.' : ''} Dispones de ${STATEMENT_DUE_HOURS} horas para pagarlo mediante Transferencia interna Bitget desde Pagos / Garantía. Si el plazo vence sin pago, la conexión API será desactivada.`,
    attachments: pdfAttachment ? [pdfAttachment] : undefined,
    type: 'info',
    templateKey: 'statement_generated',
    templateParams: {
      identifier,
      month,
      commission: String(data.commission),
      commissionDueHours: String(STATEMENT_DUE_HOURS),
      apiSubaccountId: subaccount.id,
    },
  });

  if (distributionFields.affiliateReferrerClientId) {
    // El afiliador directo recibe el aviso al mismo tiempo que el cliente
    // (su Affiliate Dashboard ya muestra la comisión: misma transacción).
    await notifyClient(distributionFields.affiliateReferrerClientId, {
      title: prepayment ? 'Comisión de afiliado pagada' : 'Nueva comisión de afiliado',
      message: prepayment
        ? `Se emitió el estado de cuenta de uno de tus referidos. Tu comisión del periodo (${distribution.affiliateCommissionAmount} USDT) ya fue PAGADA por QLC a tu UID de Bitget.`
        : `Se emitió el estado de cuenta de uno de tus referidos. Tu comisión del periodo es de ${distribution.affiliateCommissionAmount} USDT (pendiente de aprobación y pago por QLC).`,
      type: 'info',
      templateKey: 'affiliate_commission_created',
      templateParams: { amount: String(distribution.affiliateCommissionAmount) },
    }).catch(() => {});
    await logAffiliateEvent(prisma, {
      action: 'COMMISSION_CREATED_FROM_STATEMENT',
      clientId: distributionFields.affiliateReferrerClientId,
      actorUserId: req.user.id,
      details: { statementId: statement.id, referredClientId: subaccount.clientId, amount: distribution.affiliateCommissionAmount, affiliateSharePct: distribution.affiliateSharePct },
    });
  }

  res.status(201).json({
    ok: true,
    statement: shapeStatement(updatedStatement),
    // Para que el admin sepa si el correo (con el PDF) realmente salió.
    emailSent: Boolean(notification?.emailSent),
    emailError: notification?.emailError || null,
  });
});

async function markPaid(statementId) {
  const statement = await prisma.statement.findUnique({
    where: { id: statementId },
    include: { apiSubaccount: true },
  });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  if (statement.status === 'PAGADO') return statement;
  if (statement.status === 'BORRADOR') throw ApiError.conflict('Un borrador de estado de cuenta no se puede marcar como pagado.');

  const updated = await prisma.statement.update({
    where: { id: statement.id },
    data: { status: 'PAGADO', paidAt: new Date() },
  });

  // Si la conexión se había desactivado por el vencimiento y ya no queda
  // ningún otro estado de cuenta sin pagar, se reconecta.
  const stillUnpaid = await prisma.statement.count({
    where: { apiSubaccountId: statement.apiSubaccountId, status: { in: ['PENDIENTE_DE_PAGO', 'VENCIDO_SIN_PAGAR'] } },
  });
  if (!stillUnpaid && statement.apiSubaccount.status === 'DESCONECTADA') {
    await prisma.apiSubaccount.update({
      where: { id: statement.apiSubaccountId },
      data: { status: 'CONECTADA', reconnectedAt: new Date() },
    });
    await prisma.apiConnectionEvent.create({ data: { apiSubaccountId: statement.apiSubaccountId, eventType: 'RECONNECTED' } });
  }
  return updated;
}

// Confirmación manual del pago desde la subcuenta (cuando el admin ya
// validó el pago) — PAGADO y desaparece el contador.
const markStatementPaid = asyncHandler(async (req, res) => {
  const updated = await markPaid(req.params.id);
  const subaccount = await prisma.apiSubaccount.findUnique({ where: { id: updated.apiSubaccountId } });
  const identifier = clientSubaccountLabel(subaccount);
  await notifyClient(subaccount.clientId, {
    title: 'Estado de cuenta pagado',
    message: `El pago de tu estado de cuenta${identifier ? ` (subcuenta/API ${identifier})` : ''} fue confirmado por QLC. Estado: PAGADO.`,
    type: 'success',
    templateKey: 'statement_paid',
    templateParams: { identifier, apiSubaccountId: subaccount.id },
  });
  res.json({ ok: true, statement: shapeStatement(updated) });
});

const downloadStatementFile = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  if (!statement.pdfDriveFileId) throw ApiError.notFound('El PDF de este estado de cuenta no está disponible');

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(statement.pdfDriveFileId);
  res.setHeader('Content-Type', mimeType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || statement.pdfFileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// BORRAR DE "ESTADOS DE CUENTA ANTERIORES" (admin) — solo pagados y nunca el
// actual (el emitido más reciente). Se oculta para el admin; el cliente y los
// pagos no cambian.
const hideStatementForAdmin = asyncHandler(async (req, res) => {
  const statement = await prisma.statement.findUnique({ where: { id: req.params.id } });
  if (!statement || statement.adminHiddenAt || statement.status === 'BORRADOR') {
    throw ApiError.notFound('Estado de cuenta no encontrado');
  }
  const latest = await prisma.statement.findFirst({
    where: { apiSubaccountId: statement.apiSubaccountId, status: { not: 'BORRADOR' } },
    orderBy: { generatedAt: 'desc' },
    select: { id: true },
  });
  if (latest?.id === statement.id) throw ApiError.badRequest('El estado de cuenta actual no se puede borrar.');
  if (effectiveStatementStatus(statement) !== 'PAGADO') {
    throw ApiError.badRequest('Solo se pueden borrar estados de cuenta ya pagados.');
  }
  await prisma.statement.update({ where: { id: statement.id }, data: { adminHiddenAt: new Date() } });
  res.json({ ok: true });
});

// ADJUNTOS DEL ESTADO DE CUENTA (documento QLC Affiliate Program §8/§11.2):
// administración puede adjuntar archivos (imágenes o PDF, firma real
// validada) además del PDF principal. Binarios en Drive (carpeta "Estados de
// cuenta" del cliente); en NeonDB solo metadata. El cliente los ve en su
// estado de cuenta; el afiliador nunca.
const uploadStatementAttachments = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw ApiError.badRequest('Adjunta al menos un archivo.');
  assertSafeFiles(files, { maxBytes: 10 * 1024 * 1024, maxLabel: '10 MB' });
  const statement = await prisma.statement.findUnique({
    where: { id: req.params.id },
    include: { apiSubaccount: { include: { client: true } } },
  });
  if (!statement) throw ApiError.notFound('Estado de cuenta no encontrado');
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con Google Drive para guardar los adjuntos.');
  }
  const folderId = await driveStorage.getOrCreateSubfolder(statement.apiSubaccount.client, 'statements');
  const uploaded = [];
  try {
    for (const file of files) {
      const fileName = safeFileName(`Adjunto_estado_${statement.periodEnd.toISOString().slice(0, 10)}_${file.originalname}`);
      const saved = await driveStorage.uploadFileToDrive(file.buffer, { folderId, fileName, mimeType: file.mimetype });
      uploaded.push({ fileName, mimeType: file.mimetype, sizeBytes: file.size, driveFileId: saved.id, driveFolderId: folderId });
    }
  } catch {
    await Promise.all(uploaded.map((f) => driveStorage.deleteDriveFileOnlyWhenAuthorized(f.driveFileId, { authorized: true }).catch(() => {})));
    throw ApiError.serviceUnavailable('No se pudieron guardar los adjuntos en Google Drive. Intenta nuevamente.');
  }
  await prisma.statementAttachment.createMany({
    data: uploaded.map((f) => ({ ...f, statementId: statement.id, uploadedByUserId: req.user.id })),
  });
  const attachments = await prisma.statementAttachment.findMany({
    where: { statementId: statement.id },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.status(201).json({ ok: true, attachments });
});

const downloadStatementAttachment = asyncHandler(async (req, res) => {
  const att = await prisma.statementAttachment.findFirst({ where: { id: req.params.attachmentId, statementId: req.params.id } });
  if (!att) throw ApiError.notFound('Adjunto no encontrado');
  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(att.driveFileId);
  res.setHeader('Content-Type', mimeType || att.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || att.fileName)}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

module.exports = {
  uploadStatementAttachments,
  downloadStatementAttachment,
  hideStatementForAdmin,
  listStatements,
  createStatement,
  saveStatementDraft,
  deleteStatementDraft,
  markStatementPaid,
  markPaid,
  downloadStatementFile,
};
