const prisma = require('../config/prisma');

/*
 * Crea una notificación real para el usuario dueño de un ClientProfile.
 * Se usa desde acciones administrativas (confirmar condición, activar
 * cliente, revisar pago, autorizar cita, etc.) para que el cliente vea
 * el cambio reflejado en su portal — nunca es un dato simulado.
 */
async function notifyClient(clientProfileId, { title, message, type = 'info' }) {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientProfileId },
    select: { userId: true },
  });
  if (!client) return null;
  return prisma.notification.create({
    data: { userId: client.userId, title, message, type },
  });
}

module.exports = { notifyClient };
