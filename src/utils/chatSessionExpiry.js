/*
 * Cierre perezoso de una sesión de chat vencida — mismo patrón que
 * connectionDeadlines.js (no hay cron en este proyecto): se revisa cada vez
 * que alguien (admin o cliente) consulta la sesión. La primera vez que se
 * detecta el vencimiento, además de cerrarla, se avisa a los admins de que
 * la conversación ya puede descargarse en PDF — `expiryNotifiedAt` evita
 * repetir ese aviso en lecturas posteriores.
 */
const prisma = require('../config/prisma');
const { notifyAdmins } = require('./notify');

async function closeExpiredChatSession(session) {
  if (session.expiryNotifiedAt) {
    return prisma.chatSession.update({ where: { id: session.id }, data: { status: 'CLOSED' } });
  }

  const full = await prisma.chatSession.findUnique({
    where: { id: session.id },
    include: { client: { select: { firstName: true, lastName: true } } },
  });
  const clientName = `${full?.client?.firstName || ''} ${full?.client?.lastName || ''}`.trim() || 'un cliente';

  const updated = await prisma.chatSession.update({
    where: { id: session.id },
    data: { status: 'CLOSED', expiryNotifiedAt: new Date() },
  });

  await notifyAdmins({
    title: 'Chat de 15 minutos finalizado',
    message: `La sesión de chat con ${clientName} finalizó. Ya puedes descargar la conversación en PDF desde Soporte.`,
    type: 'info',
    templateKey: 'chat_session_ended',
    templateParams: { clientName, chatSessionId: session.id },
  });

  return updated;
}

module.exports = { closeExpiredChatSession };
