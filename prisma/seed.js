require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

const MODELS = [
  {
    key: 'FLEXIBLE',
    name: 'Flexible',
    tagline: 'Flexibilidad y liquidez.',
    description:
      'Modelo orientado a quienes priorizan disponibilidad y flexibilidad. El rendimiento depende de las condiciones de volatilidad del mercado.',
    conditions: null,
    period: null,
    percentage: null,
    objective: null,
    displayOrder: 1,
  },
  {
    key: 'PERFORMANCE',
    name: 'Performance',
    tagline: 'Participación en resultados.',
    description:
      'La participación de QLC está vinculada a la ganancia efectivamente generada: 70% QLC / 30% Cliente.',
    conditions: '70% QLC / 30% Cliente',
    period: null,
    percentage: '70/30',
    objective: null,
    displayOrder: 2,
  },
  {
    key: 'COMPOUND',
    name: 'Compound',
    tagline: 'Permanencia y capitalización.',
    description:
      'Modelo orientado a permanencia y reinversión, bajo un objetivo anual del 40% y los términos contractuales aplicables.',
    conditions: 'Términos contractuales aplicables',
    period: 'Anual',
    percentage: null,
    objective: '40%',
    displayOrder: 3,
  },
];

const FAQS = [
  {
    question: '¿Qué es QLC?',
    answer:
      'QLC es un sistema de copytrading institucional que permite ejecutar una estrategia de trading institucional directamente sobre la cuenta del cliente mediante tecnología propia y conexión API.',
    displayOrder: 1,
  },
  {
    question: '¿Dónde permanece mi capital?',
    answer:
      'El capital permanece en la cuenta del cliente en el exchange. QLC no necesita recibir los fondos para ejecutar la estrategia.',
    displayOrder: 2,
  },
  {
    question: '¿Cómo se conecta mi cuenta?',
    answer:
      'El cliente autoriza una conexión API con permisos limitados. Esa conexión permite a QLC ejecutar operaciones, sin autorización para retirar fondos.',
    displayOrder: 3,
  },
  {
    question: '¿Qué tamaño de cuenta está contemplado?',
    answer:
      'La arquitectura comercial de QLC está diseñada para operar con cuentas individuales desde 20 USDT hasta 400 USDT.',
    displayOrder: 4,
  },
  {
    question: '¿QLC utiliza el copytrading nativo del exchange?',
    answer:
      'No. El modelo se basa en infraestructura propia y en una conexión API directa con la cuenta autorizada del cliente.',
    displayOrder: 5,
  },
];

const PUBLIC_CONTENT = [
  ['hero', 'eyebrow', 'Institutional Copytrading Infrastructure'],
  ['hero', 'title_line1', 'Trading institucional.'],
  ['hero', 'title_line2', 'Accesible desde 20 USDT.'],
  [
    'hero',
    'lead',
    'QLC es un sistema de copytrading institucional que ejecuta nuestra estrategia directamente en la cuenta del cliente mediante tecnología propia y una conexión API autorizada.',
  ],
  ['hero', 'mini_platform_label', 'BITGET'],
  ['hero', 'mini_platform_value', 'Elite Trader'],

  ['microposiciones', 'range', '20–400 USDT'],
  [
    'microposiciones',
    'lead',
    'QLC adapta una arquitectura de trading institucional a cuentas individuales mediante una metodología basada en microposiciones y ejecución sistemática.',
  ],

  [
    'modelos',
    'note',
    'Las referencias de rendimiento son objetivos o parámetros del modelo y no constituyen una garantía de resultados futuros.',
  ],

  [
    'sobre_qlc',
    'intro',
    'QLC es una empresa enfocada en infraestructura tecnológica para la ejecución de estrategias algorítmicas y cuantitativas aplicadas a mercados de activos digitales.',
  ],
  [
    'sobre_qlc',
    'body_1',
    'QLC desarrolla y opera infraestructura tecnológica especializada para conectar, coordinar y ejecutar estrategias de trading sobre cuentas individuales de sus usuarios.',
  ],
  [
    'sobre_qlc',
    'body_2',
    'Nuestra función se centra en proporcionar la tecnología, los sistemas y la infraestructura necesarios para una ejecución estructurada y coordinada.',
  ],
  [
    'sobre_qlc',
    'body_3',
    'QLC no es un banco, no es una institución financiera y no custodia directamente los fondos de sus usuarios. Los fondos permanecen en la cuenta del propio cliente en el exchange correspondiente, bajo su titularidad y control.',
  ],

  [
    'resultados',
    'lead_1',
    'No te pedimos que confíes ciegamente en nosotros. Te damos acceso a una referencia externa para que puedas verificar nuestro track record directamente en Bitget.',
  ],
  [
    'resultados',
    'lead_2',
    'Este perfil de trading está conectado mediante API a nuestra infraestructura tecnológica.',
  ],

  ['contacto', 'kicker', 'QUANTUM LIQUIDITY CAPITAL'],
  ['contacto', 'title', 'COPYTRADING INSTITUCIONAL.'],
  ['contacto', 'sub', 'Trading cuantitativo · Algoritmos · API Execution · Microposiciones'],

  [
    'footer',
    'disclaimer',
    'Los activos digitales y el trading apalancado implican riesgos significativos. Los resultados históricos no garantizan resultados futuros. La información presentada es de carácter informativo y está sujeta a los términos y condiciones aplicables.',
  ],
  ['footer', 'tagline', 'Trading institucional. Accesible desde 20 USDT.'],
];

async function main() {
  console.log('Seeding QLC — datos iniciales...');

  // --- Admin inicial ---
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminUsername = process.env.SEED_ADMIN_USERNAME;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (adminEmail && adminUsername && adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await prisma.user.create({
        data: {
          email: adminEmail,
          username: adminUsername,
          passwordHash,
          role: 'ADMIN',
          adminProfile: {
            create: { firstName: 'QLC', lastName: 'Admin', permissions: { superadmin: true } },
          },
        },
      });
      console.log(`Administrador inicial creado: ${adminUsername} <${adminEmail}>`);
      console.log('IMPORTANTE: cambia esta contraseña después del primer inicio de sesión.');
    } else {
      console.log('Administrador inicial ya existía, se omite.');
    }
  } else {
    console.log('SEED_ADMIN_* no configurado en .env — no se creó administrador inicial.');
  }

  // --- Modelos de participación ---
  for (const model of MODELS) {
    await prisma.model.upsert({
      where: { key: model.key },
      update: model,
      create: model,
    });
  }
  console.log(`Modelos sincronizados: ${MODELS.length}`);

  // --- FAQ ---
  const faqCount = await prisma.fAQ.count();
  if (faqCount === 0) {
    await prisma.fAQ.createMany({ data: FAQS });
    console.log(`FAQ creadas: ${FAQS.length}`);
  } else {
    console.log('FAQ ya existían, se omite.');
  }

  // --- Track Record ---
  const trackRecordCount = await prisma.trackRecord.count();
  if (trackRecordCount === 0) {
    await prisma.trackRecord.create({
      data: {
        title: 'Una referencia externa y verificable.',
        description:
          'De esta manera, el rendimiento que puedes verificar corresponde a una fuente pública e independiente de QLC.',
        platformName: 'Bitget',
        profileLink: null,
        ranking: '#XXX',
      },
    });
    console.log('Track Record inicial creado (placeholder administrable).');
  } else {
    console.log('Track Record ya existía, se omite.');
  }

  // --- Contenido público ---
  for (const [section, key, value] of PUBLIC_CONTENT) {
    await prisma.publicContent.upsert({
      where: { section_key: { section, key } },
      update: {},
      create: { section, key, value },
    });
  }
  console.log(`Contenido público sincronizado: ${PUBLIC_CONTENT.length} entradas.`);

  // --- Configuración de pagos (singleton) ---
  const paymentConfigCount = await prisma.paymentConfiguration.count();
  if (paymentConfigCount === 0) {
    await prisma.paymentConfiguration.create({
      data: {
        instructions: 'Configura el QR, wallet y enlace de pago desde el panel administrativo.',
      },
    });
    console.log('Configuración de pagos inicial creada.');
  }

  // --- Disponibilidad de citas (Lunes a Viernes, 09:00-17:00) ---
  const slotCount = await prisma.availabilitySlot.count();
  if (slotCount === 0) {
    await prisma.availabilitySlot.createMany({
      data: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00',
        endTime: '17:00',
      })),
    });
    console.log('Disponibilidad de citas inicial creada (Lunes-Viernes 09:00-17:00).');
  }

  console.log('Seed completado.');
}

main()
  .catch((err) => {
    console.error('Error en seed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
