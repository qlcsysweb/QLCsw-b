const { z } = require('zod');
const QRCode = require('qrcode');
const prisma = require('../../config/prisma');
const asyncHandler = require('../../utils/asyncHandler');
const imageStorage = require('../../services/imageStorage');

// CORRECCIÓN 28 — wallet personal del cliente: la cuenta externa a la que
// QLC podría transferir fondos en el supuesto contractual establecido.
// Solo se almacena el dato; nunca se ejecuta ninguna transferencia desde
// aquí.

const getWallet = asyncHandler(async (req, res) => {
  const client = await prisma.clientProfile.findUnique({
    where: { id: req.clientProfile.id },
    select: { walletAddress: true, walletNetwork: true, walletQrUrl: true },
  });
  res.json({ ok: true, wallet: client });
});

const updateWalletSchema = z.object({
  walletAddress: z.string().max(500).optional(),
  walletNetwork: z.string().max(100).optional(),
});

const updateWallet = asyncHandler(async (req, res) => {
  const data = updateWalletSchema.parse(req.body);
  const current = await prisma.clientProfile.findUnique({
    where: { id: req.clientProfile.id },
    select: { walletAddress: true, walletQrPublicId: true },
  });

  const nextAddress = data.walletAddress !== undefined ? data.walletAddress : current.walletAddress;

  let qrData = {};
  if (data.walletAddress !== undefined && data.walletAddress !== current.walletAddress) {
    if (current.walletQrPublicId) {
      await imageStorage.deleteImage(current.walletQrPublicId).catch(() => {});
    }
    if (nextAddress) {
      const qrBuffer = await QRCode.toBuffer(nextAddress, { width: 300 });
      const image = await imageStorage.uploadImage(qrBuffer, { folder: imageStorage.FOLDERS.WALLET_QR });
      qrData = { walletQrUrl: image.url, walletQrPublicId: image.publicId };
    } else {
      qrData = { walletQrUrl: null, walletQrPublicId: null };
    }
  }

  const updated = await prisma.clientProfile.update({
    where: { id: req.clientProfile.id },
    data: {
      ...(data.walletAddress !== undefined ? { walletAddress: data.walletAddress } : {}),
      ...(data.walletNetwork !== undefined ? { walletNetwork: data.walletNetwork } : {}),
      ...qrData,
    },
    select: { walletAddress: true, walletNetwork: true, walletQrUrl: true },
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

  res.json({ ok: true, wallet: updated });
});

module.exports = { getWallet, updateWallet };
