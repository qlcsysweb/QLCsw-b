import { prisma } from '../config/prisma.js';
import { badRequest } from '../utils/httpError.js';

const MAX_LIST = 100;
const MAX_MESSAGE = 600;

// A dónde lleva cada notificación al abrirla, según el tipo de evento.
const LINKS = {
  BIENVENIDA: '/app',
  PRUEBA_GRATIS: '/app/acceso#prueba-gratis',
  ACCESO_ACTIVADO: '/app/acceso',
  ACCESO_VENCIDO: '/app/acceso',
  RETENCION: '/app/acceso',
  PAGO_BITGET_RECHAZADO: '/app/acceso',
  COMPROBANTE_RECIBIDO: '/app/acceso',
  PROMOCION: '/app/acceso#promocion',
  CODIGOS_REGALO: '/app/acceso',
  REGALO_ACTIVADO: '/app/acceso',
  CITA_ACTUALIZADA: '/app/asesoria',
  CONSULTA_RESPONDIDA: '/app/academia',
  EJERCICIO_RESPONDIDO: '/app/academia',
  CONTRASENA_CAMBIADA: '/app/acceso',
};

const view = (n) => ({ id: n.id, type: n.type, title: n.title, message: n.message, link: n.link, isRead: n.isRead, createdAt: n.createdAt });

// La tabla puede no existir todavía si la migración no se ha aplicado: la plataforma sigue funcionando.
const missingTable = (err) => err?.code === 'P2021' || err?.code === 'P2022';

export async function notifyUser(userId, { type, title, message, link }) {
  if (!userId || !title) return null;
  try {
    return await prisma.notification.create({
      data: { userId, type, title: String(title).slice(0, 200), message: String(message || '').slice(0, MAX_MESSAGE), link: link ?? LINKS[type] ?? null },
    });
  } catch (err) {
    if (!missingTable(err)) console.error('[notificaciones] no se pudo crear:', err.message);
    return null;
  }
}

export async function notifyByEmail(email, payload) {
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() }, select: { id: true } }).catch(() => null);
  return user ? notifyUser(user.id, payload) : null;
}

export async function listNotifications(userId) {
  try {
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: MAX_LIST }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { notifications: rows.map(view), unread };
  } catch (err) {
    if (missingTable(err)) return { notifications: [], unread: 0 };
    throw err;
  }
}

const cleanIds = (ids) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => typeof id === 'string' && id.length <= 64)) throw badRequest('Selecciona al menos una notificación');
  return ids;
};

// Siempre se filtra por userId: nadie puede leer ni borrar notificaciones de otra persona.
export async function markRead(userId, ids) {
  const { count } = await prisma.notification.updateMany({ where: { userId, id: { in: cleanIds(ids) } }, data: { isRead: true } });
  return { updated: count };
}

export async function markAllRead(userId) {
  const { count } = await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  return { updated: count };
}

export async function deleteNotifications(userId, ids) {
  const { count } = await prisma.notification.deleteMany({ where: { userId, id: { in: cleanIds(ids) } } });
  return { deleted: count };
}

export async function deleteAll(userId) {
  const { count } = await prisma.notification.deleteMany({ where: { userId } });
  return { deleted: count };
}
