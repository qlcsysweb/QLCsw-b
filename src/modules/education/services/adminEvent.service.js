import { prisma } from '../config/prisma.js';
import { num } from '../utils/money.js';
import { sendEmail } from './email.service.js';
import { notificationAccount, notificationSettings } from './mailSettings.service.js';
import { notifyUser } from './notification.service.js';

export const EVENT_LABELS = {
  CONTRATADA: 'Suscripción contratada',
  ACTIVADA: 'Suscripción activada',
  RENOVADA: 'Suscripción renovada',
  VENCIDA: 'Suscripción vencida',
  CANCELADA: 'Suscripción cancelada',
  PAGO_EXITOSO: 'Pago exitoso',
  PAGO_FALLIDO: 'Pago fallido',
  RECUPERADA: 'Suscripción recuperada',
  IMPORTE_NO_COINCIDE: 'Pago con importe distinto al esperado',
  PAGO_REVERTIDO: 'Pago reembolsado o con contracargo',
  PASARELA_CONFIGURADA: 'Configuración de la pasarela modificada',
  BITGET_REPORTADA: 'Transferencia interna Bitget reportada',
  BITGET_RECIBIDA: 'Transferencia Bitget recibida',
  BITGET_CONFIRMADA: 'Pago Bitget confirmado',
  BITGET_RECHAZADA: 'Reporte Bitget rechazado',
  BITGET_ELIMINADA: 'Reporte Bitget eliminado',
  PROMOCION_CREADA: 'Promoción creada',
  PROMOCION_ENVIADA: 'Promoción enviada por correo',
  PROMOCION_CANCELADA: 'Promoción cancelada',
  PAGO_PROMOCIONAL: 'Pago promocional confirmado',
  ACCESO_CONCEDIDO: 'Acceso concedido',
  VENCIMIENTO_MODIFICADO: 'Vencimiento modificado',
  ACCESO_RETIRADO: 'Acceso retirado',
  ACCESO_AUTORIZADO: 'Acceso promocional autorizado',
  AUTORIZACION_RECHAZADA: 'Pago promocional no autorizado',
  CONTRASENA_MAESTRA: 'Contraseña maestra configurada',
  CONTRASENA_MAESTRA_CAMBIADA: 'Contraseña maestra actualizada',
  AUTORIZACION_FALLIDA: 'Intento de autorización fallido',
  REGALO_COMPRADO: 'Regalo comprado',
  REGALO_CANJEADO: 'Regalo canjeado',
  REGALO_CANCELADO: 'Regalo cancelado',
  NUEVO_REGISTRO: 'Nuevo usuario registrado',
  SERVICIO_COMPRADO: 'Consulta u orientación adquirida',
  NUEVA_CONSULTA: 'Nueva consulta sobre ejercicios',
  AVISO_RENOVACION: 'Aviso de renovación enviado al cliente',
  CUENTA_ELIMINADA_INACTIVIDAD: 'Cuenta eliminada por falta de renovación',
  NUEVA_SOLICITUD: 'Nueva solicitud de información',
  NUEVA_CITA: 'Nueva cita de asesoría',
  CITA_CANCELADA: 'Cita de asesoría cancelada',
  EJERCICIO_ENVIADO: 'Ejercicio o duda enviada',
  MODULO_COMPLETADO: 'Módulo completado',
  DATOS_COMPARTIDOS: 'Cliente compartió sus datos',
  EDICION_AUTORIZADA: 'Cliente autorizó modificar sus datos',
  DATOS_MODIFICADOS: 'Administrador modificó datos de un cliente',
  CUENTA_ELIMINADA: 'Cuenta eliminada por el cliente',
  MASTERCLASS_TERMINADA: 'Cliente terminó una Masterclass',
  CONTRASENA_RESTABLECIDA: 'Cliente restableció su contraseña por correo',
};

export const EVENT_GROUPS = [
  ['Suscriptores y pagos', ['PAGO_EXITOSO', 'PAGO_FALLIDO', 'VENCIDA', 'CANCELADA', 'RECUPERADA', 'IMPORTE_NO_COINCIDE', 'PAGO_REVERTIDO', 'PASARELA_CONFIGURADA', 'BITGET_REPORTADA', 'AVISO_RENOVACION', 'CUENTA_ELIMINADA_INACTIVIDAD']],
  ['Promociones', ['PROMOCION_CREADA', 'PROMOCION_ENVIADA', 'PROMOCION_CANCELADA', 'PAGO_PROMOCIONAL']],
  ['Control de accesos', ['ACCESO_CONCEDIDO', 'VENCIMIENTO_MODIFICADO', 'ACCESO_RETIRADO', 'ACCESO_AUTORIZADO', 'AUTORIZACION_RECHAZADA', 'CONTRASENA_MAESTRA', 'CONTRASENA_MAESTRA_CAMBIADA', 'AUTORIZACION_FALLIDA']],
  ['Regalos', ['REGALO_COMPRADO', 'REGALO_CANJEADO', 'REGALO_CANCELADO']],
  ['Clientes y academia', ['NUEVO_REGISTRO', 'NUEVA_CONSULTA', 'NUEVA_SOLICITUD', 'NUEVA_CITA', 'CITA_CANCELADA', 'EJERCICIO_ENVIADO', 'MODULO_COMPLETADO', 'MASTERCLASS_TERMINADA', 'DATOS_COMPARTIDOS', 'EDICION_AUTORIZADA', 'CUENTA_ELIMINADA', 'CONTRASENA_RESTABLECIDA']],
].map(([label, types]) => ({ label, events: types.map((type) => ({ type, label: EVENT_LABELS[type] })) }));

export const periodOf = (offer) => {
  if (!offer) return null;
  const days = offer.accessDays || (offer.type === 'FULL_ANNUAL' ? 365 : 30);
  return days >= 365 ? 'ANUAL' : days >= 28 && days <= 31 ? 'MENSUAL' : `${days} DÍAS`;
};

export const actorOf = (user) => (user ? { actorType: user.role === 'ADMIN' ? 'ADMIN' : 'CLIENTE', actorId: user.id, actorName: user.name || user.email } : { actorType: 'SISTEMA', actorId: null, actorName: 'Sistema' });
export const GATEWAY = { actorType: 'PASARELA', actorId: null, actorName: 'Pasarela de pago' };
export const SYSTEM = { actorType: 'SISTEMA', actorId: null, actorName: 'Sistema' };

const eventView = (e) => ({
  id: e.id,
  category: e.category,
  type: e.type,
  label: EVENT_LABELS[e.type] || e.type,
  actorType: e.actorType,
  actorName: e.actorName,
  userId: e.userId,
  userName: e.userName,
  userEmail: e.userEmail,
  product: e.product,
  period: e.period,
  status: e.status,
  amount: e.amount === null ? null : num(e.amount),
  result: e.result,
  details: e.details,
  createdAt: e.createdAt,
});

async function recipients() {
  const [account, admins] = await Promise.all([
    notificationAccount(),
    prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { email: true, language: true } }),
  ]);
  const list = new Map(admins.map((a) => [a.email.toLowerCase(), a.language]));
  if (account && !list.has(account.toLowerCase())) list.set(account.toLowerCase(), undefined);
  return [...list.entries()];
}

// A qué sección del panel lleva cada aviso al abrirlo desde la campana del administrador.
const CLIENT_EVENTS = ['NUEVO_REGISTRO', 'CUENTA_ELIMINADA', 'MODULO_COMPLETADO', 'MASTERCLASS_TERMINADA', 'DATOS_COMPARTIDOS', 'EDICION_AUTORIZADA', 'CONTRASENA_RESTABLECIDA'];
const PAYMENT_EVENTS = ['PAGO_EXITOSO', 'PAGO_FALLIDO', 'IMPORTE_NO_COINCIDE', 'PAGO_REVERTIDO', 'PAGO_PROMOCIONAL'];
export function adminLinkFor(event) {
  const type = String(event.type || '');
  if (type.startsWith('BITGET_') || PAYMENT_EVENTS.includes(type)) return '/admin/pagos';
  if (type === 'PASARELA_CONFIGURADA') return '/admin/pasarela';
  if (type.startsWith('REGALO_')) return '/admin/regalos';
  if (type === 'NUEVA_SOLICITUD') return '/admin/solicitudes';
  if (type === 'NUEVA_CONSULTA' || type === 'EJERCICIO_ENVIADO') return '/admin/ejercicios';
  if (type.startsWith('CITA') || type === 'NUEVA_CITA') return '/admin/citas';
  if (CLIENT_EVENTS.includes(type)) return event.userId && type !== 'CUENTA_ELIMINADA' ? `/admin/clientes/${event.userId}` : '/admin/clientes';
  if (type.startsWith('PROMOCION') || type.startsWith('ACCESO_') || type === 'VENCIMIENTO_MODIFICADO' || type === 'AUTORIZACION_RECHAZADA') return '/admin/control-accesos';
  if (event.category === 'SUSCRIPCION') return '/admin/suscriptores';
  return '/admin';
}

// Aviso en la campana de cada administrador activo (además del correo): título del evento y su detalle.
async function notifyAdminsInApp(event) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  const message = [event.userName, event.product, event.status, event.result].filter(Boolean).join(' · ');
  await Promise.all(admins.map((a) => notifyUser(a.id, { type: 'ADMIN_EVENTO', title: EVENT_LABELS[event.type] || event.type, message, link: adminLinkFor(event) })));
}

async function notify(event) {
  if (!EVENT_LABELS[event.type]) return;
  await notifyAdminsInApp(event).catch((err) => console.error('[qlc] aviso en panel al administrador', err.message));
  const settings = await notificationSettings();
  if (settings.disabled?.includes(event.type)) return;
  const to = await recipients();
  await Promise.all(to.map(([address, lang]) => sendEmail('adminEvent', address, eventView(event), { lang })));
}

export async function recordEvent({ category, type, actor = SYSTEM, user = null, offer = null, status = null, amount = null, result = null, details = null, silent = false }, db = prisma) {
  const event = await db.adminEvent.create({
    data: {
      category,
      type,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorName: actor.actorName,
      userId: user?.id || null,
      userName: user?.name || null,
      userEmail: user?.email || null,
      product: offer?.name || null,
      period: periodOf(offer),
      status,
      amount: amount === null || amount === undefined ? null : amount,
      result,
      details,
    },
  });
  if (db === prisma && !silent) notify(event).catch((err) => console.error('[qlc] aviso al administrador', err.message));
  return event;
}

export const notifyEvent = (event) => notify(event).catch((err) => console.error('[qlc] aviso al administrador', err.message));

export async function listEvents({ category, userId, type, take = 300 } = {}) {
  const rows = await prisma.adminEvent.findMany({
    where: { ...(category ? { category } : {}), ...(userId ? { userId } : {}), ...(type ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(take) || 300, 1000),
  });
  return rows.map(eventView);
}
