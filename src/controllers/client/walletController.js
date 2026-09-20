const { z } = require('zod');
const QRCode = require('qrcode');
const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');
const driveStorage = require('../../services/driveStorageService');
const { notifyAdmins, notifyClient } = require('../../utils/notify');

// CORRECCIÓN 28 — wallet personal del cliente: la cuenta externa a la que
// QLC podría transferir fondos en el supuesto contractual establecido.
// Solo se almacena el dato; nunca se ejecuta ninguna transferencia desde
// aquí.

const getWallet = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.clientProfile.id },
    // walletQrUrl (Cloudinary) es legado: se conserva para clientes con un
    // QR subido antes de esta corrección. hasWalletQrDrive indica si ya hay
    // uno nuevo en Drive, servido por GET /client/wallet/qr.
    select: { walletAddress: true, walletNetwork: true, walletQrUrl: true, walletQrDriveFileId: true },
  });
  res.json({ ok: true, wallet: { ...client, hasWalletQrDrive: Boolean(client?.walletQrDriveFileId), walletQrDriveFileId: undefined } });
});

// Sirve el QR de wallet desde Drive por un endpoint protegido, propio del
// cliente autenticado — nunca un enlace público de Drive, y nunca el QR de
// otro cliente (siempre se lee del propio req.clientProfile).
const downloadWalletQr = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.clientProfile.id },
    select: { walletQrDriveFileId: true },
  });
  if (!client?.walletQrDriveFileId) return res.status(404).json({ ok: false, message: 'No hay un QR de wallet almacenado en Drive.' });

  const { stream, fileName, mimeType } = await driveStorage.downloadFileFromDrive(client.walletQrDriveFileId);
  res.setHeader('Content-Type', mimeType || 'image/png');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || 'wallet-qr.png')}"`);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

const updateWalletSchema = z.object({
  walletAddress: z.string().max(500).optional(),
  walletNetwork: z.string().max(100).optional(),
});

const updateWallet = asyncHandler(async (req, res) => {
  const data = updateWalletSchema.parse(req.body);
  const current = await prisma.clientProfile.findUnique({
    where: { id: req.clientProfile.id },
    select: { walletAddress: true, walletQrDriveFileId: true },
  });

  const nextAddress = data.walletAddress !== undefined ? data.walletAddress : current.walletAddress;

  // IMPLEMENTACIÓN DEFINITIVA DE GOOGLE DRIVE — el QR de wallet es un
  // archivo generado por la plataforma para un cliente específico (no un
  // recurso visual del sitio): se sube a Drive, nunca a Cloudinary. Se
  // trata como best-effort — si Drive no está configurado o falla, la
  // dirección de wallet igual se guarda; el QR queda pendiente de generar
  // en el siguiente intento (nunca bloquea el dato principal).
  let qrData = {};
  if (data.walletAddress !== undefined && data.walletAddress !== current.walletAddress) {
    if (current.walletQrDriveFileId && (await driveStorage.isConfigured())) {
      await driveStorage.deleteDriveFileOnlyWhenAuthorized(current.walletQrDriveFileId, { authorized: true }).catch(() => {});
    }
    if (nextAddress && (await driveStorage.isConfigured())) {
      try {
        const qrBuffer = await QRCode.toBuffer(nextAddress, { width: 300 });
        const qrFolderId = await driveStorage.getOrCreateSubfolder(req.clientProfile, 'qr');
        const uploaded = await driveStorage.uploadFileToDrive(qrBuffer, {
          folderId: qrFolderId,
          fileName: 'wallet-qr.png',
          mimeType: 'image/png',
        });
        qrData = { walletQrDriveFileId: uploaded.id, walletQrDriveFolderId: qrFolderId };
      } catch {
        // Best-effort: la wallet queda guardada igual sin QR generado.
      }
    } else if (!nextAddress) {
      qrData = { walletQrDriveFileId: null, walletQrDriveFolderId: null };
    }
  }

  const updated = await prisma.clientProfile.update({
    where: { id: req.clientProfile.id },
    data: {
      ...(data.walletAddress !== undefined ? { walletAddress: data.walletAddress } : {}),
      ...(data.walletNetwork !== undefined ? { walletNetwork: data.walletNetwork } : {}),
      ...qrData,
    },
    select: { walletAddress: true, walletNetwork: true, walletQrUrl: true, walletQrDriveFileId: true },
  });

  // CORRECCIÓN 1: registrar la wallet confirma el paso "WALLET" del proceso
  // de activación en TODAS las subcuentas/API del cliente — la wallet es un
  // dato del cliente, no de una subcuenta puntual, así que nunca se le
  // vuelve a pedir por cada API que tenga.
  if (updated.walletAddress) {
    const processes = await prisma.process.findMany({
      where: { apiSubaccount: { clientId: req.clientProfile.id } },
      select: { id: true },
    });
    await Promise.all(
      processes.map((p) =>
        prisma.processCondition.updateMany({
          where: { processId: p.id, type: 'WALLET' },
          data: { status: 'CONFIRMED' },
        })
      )
    );
  }

  // AUDITORÍA QLC PARTE 12 — registrar/modificar la wallet requiere que un
  // admin la revise (es la cuenta a la que QLC podría transferir fondos).
  if (data.walletAddress !== undefined && data.walletAddress !== current.walletAddress) {
    const client = await prisma.clientProfile.findUnique({ where: { id: req.clientProfile.id } });
    const wasCreated = !current.walletAddress;
    await notifyAdmins({
      title: 'Wallet actualizada por un cliente',
      message: `${client.firstName} ${client.lastName} registró/modificó su wallet${updated.walletNetwork ? ` (${updated.walletNetwork})` : ''}.`,
      type: 'info',
      templateKey: 'client_wallet_updated',
      templateParams: { clientName: `${client.firstName} ${client.lastName}`, clientId: req.clientProfile.id },
    });
    if (updated.walletAddress) {
      await notifyClient(req.clientProfile.id, {
        title: wasCreated ? 'Wallet creada con éxito' : 'Wallet actualizada',
        message: wasCreated
          ? 'Tu wallet personal fue creada con éxito.'
          : 'Tu wallet personal fue actualizada correctamente.',
        type: 'success',
        templateKey: 'wallet_saved',
        templateParams: { status: wasCreated ? 'creada' : 'actualizada' },
      });
    }
  }

  res.json({ ok: true, wallet: { ...updated, hasWalletQrDrive: Boolean(updated.walletQrDriveFileId), walletQrDriveFileId: undefined } });
});

module.exports = { getWallet, updateWallet, downloadWalletQr };
