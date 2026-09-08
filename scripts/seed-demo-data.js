/*
 * Datos de DEMOSTRACIÓN para la presentación a QLC.
 * - Todos los clientes creados aquí tienen isDemo=true y nombres/emails
 *   evidentemente ficticios (Cliente Demo 0X / demoXX@example.com).
 * - NO se suben archivos falsos a Google Drive ni a Cloudinary: el estado
 *   de "avance" se representa con datos reales de negocio (condiciones de
 *   proceso, pagos, citas, notificaciones) que no dependen de ningún
 *   archivo. Si Google Drive no está configurado, documentos y contratos
 *   quedan honestamente en su estado real "pendiente" — no se finge nada.
 *
 * Ejecutar con: node scripts/seed-demo-data.js
 * Es idempotente: primero elimina cualquier demo previo (isDemo=true).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

// Seguro de fábrica: este script borra y recrea cuentas demo — nunca debe
// poder correr contra una base de producción por accidente. Para forzarlo
// deliberadamente (no recomendado) exportar ALLOW_DEMO_SEED_IN_PRODUCTION=true.
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED_IN_PRODUCTION !== 'true') {
  console.error(
    'Bloqueado: NODE_ENV=production. Este script crea/borra cuentas DEMO y no debe ' +
      'ejecutarse en producción. Si de verdad necesitas hacerlo, exporta ' +
      'ALLOW_DEMO_SEED_IN_PRODUCTION=true explícitamente y vuelve a intentarlo.'
  );
  process.exit(1);
}

const DEMO_PASSWORD = 'QlcDemo2026!';
const CONDITION_TYPES = ['CONTRACT', 'FUNDS', 'PAYMENT', 'API', 'ACTIVATION'];

async function removeExistingDemoData() {
  // Prospectos demo (identificados por el patrón de email prospecto.demoXX@ /
  // Demo01@Example.com usado exclusivamente aquí)
  const demoProspectFilter = {
    OR: [
      { email: { contains: 'prospecto.demo', mode: 'insensitive' } },
      { email: { equals: 'Demo01@Example.com', mode: 'insensitive' } },
    ],
  };
  const deletedProspects = await prisma.prospect.deleteMany({ where: demoProspectFilter });
  console.log(`Prospectos demo previos eliminados: ${deletedProspects.count}`);

  const demoUsers = await prisma.user.findMany({
    where: { clientProfile: { isDemo: true } },
    select: { id: true, username: true },
  });
  for (const u of demoUsers) {
    await prisma.user.delete({ where: { id: u.id } }).catch(async (err) => {
      // Si hay chat_messages con RESTRICT, limpiar sesiones de chat primero
      const client = await prisma.clientProfile.findUnique({ where: { userId: u.id } });
      if (client) {
        await prisma.chatSession.deleteMany({ where: { clientId: client.id } });
        await prisma.appointment.deleteMany({ where: { clientId: client.id } });
      }
      await prisma.user.delete({ where: { id: u.id } });
    });
  }
  console.log(`Datos demo previos eliminados: ${demoUsers.length} cuenta(s).`);
}

async function createDemoClient({ firstName, lastName, email, username, phone, modelKey, clientStatus }) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const model = await prisma.model.findUnique({ where: { key: modelKey } });

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          firstName,
          lastName,
          phone,
          status: clientStatus,
          isDemo: true,
          notes: 'Cuenta de demostración para presentación a QLC — no es un cliente real.',
          process: {
            create: {
              conditions: { create: CONDITION_TYPES.map((type) => ({ type, status: 'PENDING' })) },
            },
          },
          apiConnection: { create: { status: 'PENDIENTE' } },
          ...(model ? { clientModel: { create: { modelId: model.id, confirmedAt: new Date() } } } : {}),
        },
      },
    },
    include: { clientProfile: { include: { process: { include: { conditions: true } } } } },
  });

  return user.clientProfile;
}

async function setCondition(processId, type, status) {
  await prisma.processCondition.update({
    where: { processId_type: { processId, type } },
    data: { status },
  });
}

async function notify(userId, title, message, type = 'info') {
  await prisma.notification.create({ data: { userId, title, message, type } });
}

async function main() {
  await removeExistingDemoData();
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } });

  // ---------- CLIENTE DEMO 01 — proceso avanzado, activo ----------
  const demo01 = await createDemoClient({
    firstName: 'Cliente',
    lastName: 'Demo 01',
    email: 'demo01@example.com',
    username: 'demo01',
    phone: '+1 555 0101',
    modelKey: 'PERFORMANCE',
    clientStatus: 'PENDING',
  });

  for (const type of CONDITION_TYPES) {
    await setCondition(demo01.process.id, type, 'CONFIRMED');
  }
  await prisma.process.update({
    where: { id: demo01.process.id },
    data: { isActivated: true, activatedAt: new Date() },
  });
  await prisma.clientProfile.update({ where: { id: demo01.id }, data: { status: 'ACTIVE' } });
  await prisma.apiConnection.update({
    where: { clientId: demo01.id },
    data: { status: 'CONECTADA', exchangeName: 'Bitget', updatedByUserId: admin.id },
  });
  // Estado de contrato honesto: solo el status (sin archivo real, ya que no
  // se sube nada falso a Drive) — coherente con la condición CONTRACT=CONFIRMED.
  await prisma.contract.create({ data: { clientId: demo01.id, status: 'RECEIVED_SIGNED' } });
  const payment01 = await prisma.paymentReport.create({
    data: { clientId: demo01.id, amount: 150, currency: 'USDT', status: 'APROBADO', reviewedByUserId: admin.id, reviewedAt: new Date() },
  });
  await prisma.appointment.create({
    data: {
      clientId: demo01.id,
      requestedDate: new Date(Date.now() - 5 * 86400000),
      requestedTime: '10:00',
      status: 'COMPLETADA',
      approvedByUserId: admin.id,
    },
  });
  const demo01User = await prisma.clientProfile.findUnique({ where: { id: demo01.id }, select: { userId: true } });
  await notify(demo01User.userId, 'Tu cuenta QLC fue activada', 'Todas las condiciones de tu proceso fueron confirmadas. ¡Bienvenido!', 'success');
  await notify(demo01User.userId, 'Tu pago fue aprobado', `Tu pago de ${payment01.amount} ${payment01.currency} fue marcado como: APROBADO`, 'success');
  await notify(demo01User.userId, 'Conexión API actualizada', 'Estado de tu conexión API: CONECTADA', 'success');

  // ---------- CLIENTE DEMO 02 — proceso intermedio ----------
  const demo02 = await createDemoClient({
    firstName: 'Cliente',
    lastName: 'Demo 02',
    email: 'demo02@example.com',
    username: 'demo02',
    phone: '+1 555 0102',
    modelKey: 'FLEXIBLE',
    clientStatus: 'REVIEW',
  });
  await setCondition(demo02.process.id, 'FUNDS', 'CONFIRMED');
  const paymentReport02 = await prisma.paymentReport.create({
    data: { clientId: demo02.id, amount: 80, currency: 'USDT', status: 'PENDING' },
  });
  const appointment02 = await prisma.appointment.create({
    data: {
      clientId: demo02.id,
      requestedDate: new Date(Date.now() + 3 * 86400000),
      requestedTime: '11:30',
      status: 'AUTORIZADA',
      approvedByUserId: admin.id,
      notes: 'Cita de seguimiento — demo.',
    },
  });
  const chatSession02 = await prisma.chatSession.create({
    data: { appointmentId: appointment02.id, clientId: demo02.id, status: 'SCHEDULED', durationMinutes: 15 },
  });
  const demo02User = await prisma.clientProfile.findUnique({ where: { id: demo02.id }, select: { userId: true } });
  await notify(demo02User.userId, 'Actualización de tu cita', 'Tu solicitud de cita fue: AUTORIZADA', 'success');
  await notify(demo02User.userId, 'Actualización de tu proceso', 'Fondos disponibles: CONFIRMED', 'info');
  await prisma.supportCase.create({
    data: {
      clientId: demo02.id,
      subject: 'Consulta sobre el modelo Flexible',
      message: '¿Cuándo comienza a aplicarse el modelo una vez confirmado?',
      status: 'OPEN',
    },
  });

  // ---------- CLIENTE DEMO 03 — proceso inicial ----------
  const demo03 = await createDemoClient({
    firstName: 'Cliente',
    lastName: 'Demo 03',
    email: 'demo03@example.com',
    username: 'demo03',
    phone: '+1 555 0103',
    modelKey: 'COMPOUND',
    clientStatus: 'PENDING',
  });
  const demo03User = await prisma.clientProfile.findUnique({ where: { id: demo03.id }, select: { userId: true } });
  await notify(demo03User.userId, 'Bienvenido a QLC', 'Tu cuenta fue creada. Completa tu proceso para comenzar.', 'info');

  // ---------- PROSPECTOS DEMO — "solicitó información" ----------
  // 1) Mismo email que Demo 01 (con mayúsculas distintas) → demuestra que SÍ
  //    se registró (comparación insensible a mayúsculas/minúsculas).
  // 2) y 3) Sin cuenta asociada → demuestran "pendiente de registro".
  await prisma.prospect.create({
    data: {
      firstName: 'Prospecto',
      lastName: 'Demo 01',
      email: 'Demo01@Example.com',
      source: 'web_publica',
      infoRequested: true,
    },
  });
  await prisma.prospect.create({
    data: {
      firstName: 'Prospecto',
      lastName: 'Demo 02',
      email: 'prospecto.demo02@example.com',
      source: 'web_publica',
      infoRequested: true,
    },
  });
  await prisma.prospect.create({
    data: {
      firstName: 'Prospecto',
      lastName: 'Demo 03',
      email: 'prospecto.demo03@example.com',
      source: 'web_publica',
      infoRequested: true,
    },
  });

  console.log('\n=== Datos demo creados correctamente ===');
  console.log('Cliente Demo 01:', demo01.id, '(activo, proceso completo, pago aprobado, API conectada)');
  console.log('Cliente Demo 02:', demo02.id, '(en revisión, cita autorizada + chat, pago pendiente, caso de soporte abierto)');
  console.log('Cliente Demo 03:', demo03.id, '(pendiente, proceso inicial)');
  console.log('Prospectos demo: 1 registrado (Demo01@Example.com), 2 pendientes de registro.');
  console.log('\nCredenciales demo (misma contraseña para las 3):', DEMO_PASSWORD);
  console.log('  demo01 / demo02 / demo03');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
