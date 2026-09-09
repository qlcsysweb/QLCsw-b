/*
 * Traducción inicial al inglés del contenido administrable ya existente en
 * NeonDB (PublicContent, FAQ, Model, TrackRecord). NO borra ni modifica el
 * español (columnas originales intactas) — solo completa las columnas *En
 * agregadas en la migración 20260909113402_bilingual_content.
 *
 * Es seguro volver a ejecutarlo: siempre escribe estas mismas traducciones
 * canónicas, nunca borra contenido en español.
 *
 * Ejecutar con: node scripts/seed-en-translations.js
 */
require('dotenv').config();
const prisma = require('../src/config/prisma');

const CONTENT_EN = {
  hero: {
    eyebrow: 'Institutional Copytrading Infrastructure',
    title_line1: 'Institutional Copytrading.',
    title_line2: 'Accessible from 20 USDT.',
    lead: "QLC is an institutional copytrading system that executes our strategy directly on the client's account through proprietary technology and an authorized API connection.",
    mini_platform_label: 'BITGET',
    mini_platform_value: 'Elite Trader',
  },
  modelo: {
    kicker: 'THE CONCEPT',
    h2_line1: 'Institutional copytrading.',
    h2_line2: 'Without leaving your account.',
    intro: "QLC's strategy is executed directly on the client's account through an API connection. The capital stays in their own exchange account.",
  },
  como_funciona: {
    kicker: 'HOW IT WORKS',
    h2_line1: 'Your account.',
    h2_line2: 'Our infrastructure.',
    sub: 'The flow is direct: the client keeps their account on the exchange, authorizes an API connection, and QLC executes the strategy directly on it.',
    connection_title: 'The capital stays where it belongs.',
    connection_text: "QLC doesn't need to receive or move the client's capital to execute the strategy. The API connection allows operation on the authorized account, with limited permissions and no authorization to withdraw funds.",
  },
  tecnologia: {
    kicker: 'INFRASTRUCTURE',
    h2_line1: 'An architecture.',
    h2_line2: 'A simple experience.',
    sub: 'The technological complexity belongs to QLC. For the client, the product comes down to a connection, a strategy, and direct execution on their account.',
  },
  microposiciones: {
    range: '20–400 USDT',
    lead: 'QLC adapts an institutional trading architecture to individual accounts through a methodology based on micro-positions and systematic execution.',
  },
  modelos: {
    note: 'Performance references are targets or model parameters and do not constitute a guarantee of future results.',
  },
  resultados: {
    lead_1: "We don't ask you to blindly trust us. We give you access to an external reference so you can verify our track record directly on Bitget.",
    lead_2: 'This trading profile is connected via API to our technology infrastructure.',
  },
  seguridad: {
    kicker: 'CONTROL',
    h2_line1: 'Your account.',
    h2_line2: 'Your capital. Your control.',
  },
  sobre_qlc: {
    intro: 'QLC is a company focused on technology infrastructure for executing algorithmic and quantitative strategies applied to digital asset markets.',
    body_1: "QLC develops and operates specialized technology infrastructure to connect, coordinate, and execute trading strategies on its users' individual accounts.",
    body_2: 'Our role is centered on providing the technology, systems, and infrastructure needed for structured, coordinated execution.',
    body_3: "QLC is not a bank, is not a financial institution, and does not directly hold custody of its users' funds. Funds remain in the client's own account on the corresponding exchange, under their ownership and control.",
  },
  contacto: {
    kicker: 'QUANTUM LIQUIDITY CAPITAL',
    title: 'INSTITUTIONAL COPYTRADING.',
    sub: 'Quantitative trading · Algorithms · API Execution · Micro-positions',
  },
  footer: {
    tagline: 'Institutional trading. Accessible from 20 USDT.',
    disclaimer: 'Digital assets and leveraged trading involve significant risks. Past performance does not guarantee future results. The information presented is for informational purposes and is subject to applicable terms and conditions.',
  },
};

const FAQ_EN = [
  {
    question: '¿Qué es QLC?',
    questionEn: 'What is QLC?',
    answerEn:
      "QLC is an institutional copytrading system that executes an institutional trading strategy directly on the client's account through proprietary technology and an API connection.",
  },
  {
    question: '¿Dónde permanece mi capital?',
    questionEn: 'Where does my capital stay?',
    answerEn:
      'Your capital stays in your account on the exchange. QLC does not need to receive the funds to execute the strategy.',
  },
  {
    question: '¿Cómo se conecta mi cuenta?',
    questionEn: 'How does my account connect?',
    answerEn:
      "The client authorizes an API connection with limited permissions. That connection allows QLC to execute operations, without authorization to withdraw funds.",
  },
  {
    question: '¿Qué tamaño de cuenta está contemplado?',
    questionEn: 'What account size is supported?',
    answerEn:
      "QLC's commercial architecture is designed to operate with individual accounts ranging from 20 USDT to 400 USDT.",
  },
  {
    question: '¿QLC utiliza el copytrading nativo del exchange?',
    questionEn: "Does QLC use the exchange's native copytrading?",
    answerEn:
      "No. The model is based on proprietary infrastructure and a direct API connection with the client's authorized account.",
  },
];

const MODEL_EN = {
  FLEXIBLE: {
    nameEn: 'Flexible',
    taglineEn: 'Flexibility and liquidity.',
    descriptionEn:
      'A model designed for those who prioritize availability and flexibility. Performance depends on market volatility conditions.',
    conditionsEn: null,
    periodEn: null,
  },
  PERFORMANCE: {
    nameEn: 'Performance',
    taglineEn: 'Results-based participation.',
    descriptionEn: "QLC's share is tied to the profit actually generated: 70% QLC / 30% Client.",
    conditionsEn: '70% QLC / 30% Client',
    periodEn: null,
  },
  COMPOUND: {
    nameEn: 'Compound',
    taglineEn: 'Commitment and compounding.',
    descriptionEn:
      'A model oriented toward commitment and reinvestment, under a 40% annual target and the applicable contractual terms.',
    conditionsEn: 'Applicable contractual terms',
    periodEn: 'Annual',
  },
};

const TRACK_RECORD_EN = {
  titleEn: 'An external, verifiable reference.',
  descriptionEn:
    'This way, the performance you can verify comes from a source that is public and independent of QLC.',
};

async function main() {
  console.log('Sembrando traducciones al inglés del contenido existente...');

  let contentUpdated = 0;
  for (const [section, keys] of Object.entries(CONTENT_EN)) {
    for (const [key, valueEn] of Object.entries(keys)) {
      const result = await prisma.publicContent.updateMany({
        where: { section, key },
        data: { valueEn },
      });
      contentUpdated += result.count;
    }
  }
  console.log(`PublicContent: ${contentUpdated} fila(s) actualizadas con traducción al inglés.`);

  let faqUpdated = 0;
  for (const item of FAQ_EN) {
    const result = await prisma.fAQ.updateMany({
      where: { question: item.question },
      data: { questionEn: item.questionEn, answerEn: item.answerEn },
    });
    faqUpdated += result.count;
  }
  console.log(`FAQ: ${faqUpdated} fila(s) actualizadas con traducción al inglés.`);

  let modelUpdated = 0;
  for (const [key, data] of Object.entries(MODEL_EN)) {
    const result = await prisma.model.updateMany({ where: { key }, data });
    modelUpdated += result.count;
  }
  console.log(`Model: ${modelUpdated} fila(s) actualizadas con traducción al inglés.`);

  const trackRecord = await prisma.trackRecord.findFirst();
  if (trackRecord) {
    await prisma.trackRecord.update({ where: { id: trackRecord.id }, data: TRACK_RECORD_EN });
    console.log('TrackRecord: 1 fila actualizada con traducción al inglés.');
  }

  console.log('Listo — el contenido en español permanece intacto en sus columnas originales.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
