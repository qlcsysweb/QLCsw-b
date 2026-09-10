require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

/*
 * SEED_ADMIN_PASSWORD es una contraseña de ARRANQUE (bootstrap), no una
 * credencial permanente del sistema: solo sirve para crear la primera
 * cuenta ADMIN cuando NeonDB todavía no tiene ninguna. Una vez que esa
 * cuenta existe, la contraseña real vive exclusivamente como hash
 * (bcrypt) en NeonDB — mantenerla también en texto plano en .env no
 * aporta nada y sí es un riesgo, así que esta función la borra del
 * archivo .env automáticamente (sin tocar ninguna otra variable).
 * Nunca se imprime el valor de la contraseña en consola.
 */
function scrubBootstrapPasswordFromEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  if (!/^SEED_ADMIN_PASSWORD=.+$/m.test(content)) return; // ya está vacía o no existe la línea

  const updated = content.replace(/^SEED_ADMIN_PASSWORD=.*$/m, 'SEED_ADMIN_PASSWORD=');
  fs.writeFileSync(envPath, updated, 'utf8');
  console.log(
    'SEED_ADMIN_PASSWORD eliminada de .env: la cuenta admin ya existe en NeonDB con su contraseña ' +
      'hasheada. Si necesitas otra cuenta admin, créala desde el panel (Administradores) o usa ' +
      '"Cambiar contraseña" para la existente.'
  );
}

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
    question: '¿Cómo funciona el incremento de mi capital dentro del modelo QLC?',
    questionEn: 'How does the growth of my capital work within the QLC model?',
    answer:
      'El acceso se gana. La confianza también.\n\nQLC no recibe capital de inversión. El capital permanece siempre en la cuenta del cliente.\n\nLos incrementos de saldo dentro del modelo se habilitan únicamente por invitación, conforme se desarrolla una relación de confianza entre el cliente QLC, considerando el cumplimiento oportuno de sus pagos y la correcta ejecución de nuestra estrategia.\n\nMás confianza. Mayor capacidad de participación.',
    answerEn:
      "Access is earned. So is trust.\n\nQLC does not receive investment capital. Capital always remains in the client's own account.\n\nBalance increases within the model are enabled only by invitation, as a relationship of trust develops with the QLC client, taking into account timely payment compliance and the correct execution of our strategy.\n\nMore trust. Greater capacity to participate.",
    displayOrder: 3,
  },
  {
    question: '¿Cómo se conecta mi cuenta?',
    answer:
      'El cliente autoriza una conexión API con permisos limitados. Esa conexión permite a QLC ejecutar operaciones, sin autorización para retirar fondos.',
    displayOrder: 4,
  },
  {
    question: '¿Qué tamaño de cuenta está contemplado?',
    answer:
      'La arquitectura comercial de QLC está diseñada para operar con cuentas individuales desde 20 USDT hasta 400 USDT.',
    displayOrder: 5,
  },
  {
    question: '¿QLC utiliza el copytrading nativo del exchange?',
    answer:
      'No. El modelo se basa en infraestructura propia y en una conexión API directa con la cuenta autorizada del cliente.',
    displayOrder: 6,
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

  // CORRECCIÓN 26 — sección pública "El problema"
  ['problema', 'title', 'EL JUEGO NO ES PAREJO.', 'THE GAME ISN\'T LEVEL.'],
  ['problema', 'lead', 'El 95% pierde. El 5% opera con otra infraestructura.', '95% lose. 5% operate with a different infrastructure.'],
  [
    'problema', 'body_1',
    'La mayoría de los traders minoristas enfrenta los mercados con herramientas limitadas: gráficos, indicadores y líneas en una pantalla, intentando anticipar si el precio subirá o bajará.',
    'Most retail traders face the markets with limited tools: charts, indicators and lines on a screen, trying to anticipate whether the price will rise or fall.',
  ],
  [
    'problema', 'body_2',
    'Mientras tanto, el entorno profesional utiliza modelos cuantitativos, algoritmos, software especializado y herramientas de análisis de última generación, desarrolladas para procesar información y ejecutar estrategias con una capacidad que un operador humano no puede igualar.',
    'Meanwhile, the professional environment uses quantitative models, algorithms, specialized software and state-of-the-art analysis tools, built to process information and execute strategies with a capacity no human operator can match.',
  ],
  [
    'problema', 'body_3',
    'El problema no siempre es la estrategia. Es la infraestructura disponible para ejecutarla.',
    "The problem isn't always the strategy. It's the infrastructure available to execute it.",
  ],
  ['problema', 'body_4', 'QLC cambia esa ecuación.', 'QLC changes that equation.'],
  [
    'problema', 'body_5',
    'Ponemos al alcance de inversores individuales una infraestructura de Copytrading Institucional, basada en nuestra propia estrategia, tecnología y sistemas de ejecución.',
    'We put an institutional Copytrading infrastructure within reach of individual investors, built on our own strategy, technology and execution systems.',
  ],
  ['problema', 'body_6', 'Desde 20 USDT.', 'Starting from 20 USDT.'],
  [
    'problema', 'body_7',
    'Tu cuenta sigue siendo individual. Nuestra gestión es global.',
    'Your account remains individual. Our management is global.',
  ],
  [
    'problema', 'body_8',
    'Tú ves tu cuenta. Nosotros vemos tu cuenta como parte de una estructura global de miles de cuentas.',
    'You see your account. We see your account as part of a global structure of thousands of accounts.',
  ],
  [
    'problema', 'body_9',
    'La diferencia no está solamente en lo que ves en el gráfico. Está en todo lo que ocurre detrás de él.',
    "The difference isn't only in what you see on the chart. It's in everything that happens behind it.",
  ],
  [
    'problema', 'closing',
    'QLC — Infraestructura institucional. Ahora al alcance del inversor individual.',
    'QLC — Institutional infrastructure. Now within reach of the individual investor.',
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
  ['footer', 'tagline', 'Copytrading Institucional. Accesible desde 20 USDT.'],
];

async function main() {
  console.log('Seeding QLC — datos iniciales...');

  // --- Admin inicial ---
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          role: 'ADMIN',
          adminProfile: {
            create: { firstName: 'QLC', lastName: 'Admin', permissions: { superadmin: true } },
          },
        },
      });
      console.log(`Administrador inicial creado: <${adminEmail}>`);
      console.log('IMPORTANTE: cambia esta contraseña después del primer inicio de sesión.');
    } else {
      console.log('Administrador inicial ya existía, se omite (no se sobrescribe su contraseña).');
    }
    // Exista ya o se acabe de crear, la cuenta ya vive en NeonDB con su
    // contraseña hasheada — la copia en texto plano de .env ya no hace falta.
    scrubBootstrapPasswordFromEnv();
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
  for (const [section, key, value, valueEn] of PUBLIC_CONTENT) {
    await prisma.publicContent.upsert({
      where: { section_key: { section, key } },
      update: {},
      create: { section, key, value, valueEn: valueEn || null },
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
