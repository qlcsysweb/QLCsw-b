/*
 * CORRECCIÓN 5 — Actualiza el contenido de los 3 modelos de participación
 * (Flexible/Performance/Compound) con el texto exacto del documento
 * QLC_Guia_Modelos_Participacion_Disenador_Web.docx. Additive/update-only,
 * nunca borra modelos ni cambia sus `key` (slug), así que ClientModel
 * existentes nunca se rompen.
 */
const prisma = require('../src/config/prisma');

const updates = [
  {
    key: 'FLEXIBLE',
    name: 'Flexible',
    nameEn: 'Flexible',
    tagline: 'Libertad para tu capital',
    taglineEn: 'Freedom for your capital',
    description:
      'El modelo Flexible está diseñado para clientes que desean mantener una mayor flexibilidad sobre su capital y, al mismo tiempo, participar en una estrategia cuyo rendimiento depende de las condiciones del mercado. El resultado no se establece como una rentabilidad fija: el comportamiento del mercado y las oportunidades disponibles durante el periodo influyen directamente en el rendimiento obtenido.',
    descriptionEn:
      'The Flexible model is designed for clients who want to keep greater flexibility over their capital while participating in a strategy whose return depends on market conditions. The result is not set as a fixed return: market behavior and the opportunities available during the period directly influence the return obtained.',
    conditions: 'Volatilidad baja: hasta 1% · Volatilidad media: hasta 2.5% · Volatilidad alta: hasta 5% (mensual, objetivo)',
    conditionsEn: 'Low volatility: up to 1% · Medium volatility: up to 2.5% · High volatility: up to 5% (monthly, target)',
    period: 'Mensual',
    periodEn: 'Monthly',
    percentage: null,
    objective: 'Hasta 1% / 2.5% / 5% mensual según volatilidad',
    detailsContent:
      '¿Cómo funciona?\nQLC aplica su estrategia de gestión de acuerdo con las condiciones existentes en el mercado. Por ello, el rendimiento puede variar dependiendo del nivel de volatilidad y de las oportunidades disponibles durante el periodo.\n\nIMPORTANTE: los porcentajes son objetivos/máximos operativos de referencia y no representan una rentabilidad garantizada.\n\nCaracterísticas principales\n• El capital permanece asignado al cliente.\n• El rendimiento depende de las condiciones del mercado.\n• No existe una rentabilidad garantizada.\n• El porcentaje es un objetivo/máximo operativo, no una promesa de rendimiento.\n• El cliente mantiene exposición al modelo de gestión establecido por QLC.\n\n¿Para quién está pensado?\n"Quiero mantener mayor flexibilidad sobre mi capital y estoy dispuesto a aceptar que el rendimiento dependa de las condiciones del mercado."',
    detailsContentEn:
      'How does it work?\nQLC applies its management strategy according to existing market conditions. Because of this, the return may vary depending on the volatility level and the opportunities available during the period.\n\nIMPORTANT: the percentages are reference operating targets/maximums and do not represent a guaranteed return.\n\nMain characteristics\n• Capital remains assigned to the client.\n• Return depends on market conditions.\n• There is no guaranteed return.\n• The percentage is an operating target/maximum, not a promise of return.\n• The client remains exposed to the management model established by QLC.\n\nWho is it designed for?\n"I want to keep greater flexibility over my capital and I am willing to accept that the return depends on market conditions."',
    isActive: true,
  },
  {
    key: 'PERFORMANCE',
    name: 'Performance',
    nameEn: 'Performance',
    tagline: 'Ganamos juntos',
    taglineEn: 'We win together',
    description:
      'El modelo Performance está diseñado para que la remuneración de QLC esté directamente relacionada con el resultado generado. QLC participa únicamente de la ganancia efectivamente generada durante el periodo — no se aplica el porcentaje sobre el capital inicial.',
    descriptionEn:
      "The Performance model is designed so that QLC's compensation is directly tied to the result generated. QLC only participates in the profit effectively generated during the period — the percentage is never applied to the initial capital.",
    conditions: '70% QLC / 30% Cliente',
    conditionsEn: '70% QLC / 30% Client',
    period: null,
    periodEn: null,
    percentage: '70/30',
    objective: null,
    detailsContent:
      '¿Cómo funciona?\nLa distribución 70/30 se aplica exclusivamente sobre la utilidad efectivamente generada, nunca sobre el capital aportado.\n\nEjemplo — Capital de 100 USDT\nGanancia generada: 20 USDT → QLC recibe 14 USDT (70%) · Cliente recibe 6 USDT (30%) → Capital final: 106 USDT\nGanancia generada: 1 USDT → QLC recibe 0.70 USDT · Cliente recibe 0.30 USDT → Capital final: 100.30 USDT\n\nLa lógica es proporcional: si se generan 0 USDT, QLC recibe 0 USDT.\n\nCaracterísticas principales\n• Sin cobros sobre el capital: el porcentaje se calcula sobre la ganancia.\n• Pago únicamente sobre resultados efectivamente generados.\n• Modelo totalmente proporcional al desempeño.\n• La remuneración de QLC está directamente vinculada al resultado real obtenido.\n\n¿Para quién está pensado?\n"No quiero que QLC cobre sobre mi capital. Prefiero que su participación dependa directamente de las ganancias que realmente genere."',
    detailsContentEn:
      'How does it work?\nThe 70/30 split applies exclusively to the profit effectively generated, never to the capital contributed.\n\nExample — 100 USDT capital\nProfit generated: 20 USDT → QLC receives 14 USDT (70%) · Client receives 6 USDT (30%) → Final capital: 106 USDT\nProfit generated: 1 USDT → QLC receives 0.70 USDT · Client receives 0.30 USDT → Final capital: 100.30 USDT\n\nThe logic is proportional: if 0 USDT is generated, QLC receives 0 USDT.\n\nMain characteristics\n• No charges on capital: the percentage is calculated on the profit.\n• Payment only on results effectively generated.\n• Fully performance-proportional model.\n• QLC\'s compensation is directly tied to the actual result obtained.\n\nWho is it designed for?\n"I don\'t want QLC to charge on my capital. I prefer its participation to depend directly on the profits it actually generates."',
    isActive: true,
  },
  {
    key: 'COMPOUND',
    name: 'Compound',
    nameEn: 'Compound',
    tagline: 'Capitaliza tu futuro',
    taglineEn: 'Capitalize your future',
    description:
      'El modelo Compound está diseñado para clientes que tienen una visión de permanencia y desean permitir que las ganancias permanezcan dentro del esquema para favorecer una estrategia de capitalización. A diferencia del modelo Flexible, aquí la prioridad es la permanencia, la reinversión y el crecimiento compuesto.',
    descriptionEn:
      'The Compound model is designed for clients with a long-term view who want to let profits remain within the scheme to favor a capitalization strategy. Unlike the Flexible model, here the priority is permanence, reinvestment, and compound growth.',
    conditions: 'Términos contractuales aplicables',
    conditionsEn: 'Applicable contractual terms',
    period: 'Anual',
    periodEn: 'Annual',
    percentage: null,
    objective: '40% (Anual)',
    detailsContent:
      '¿Cómo funciona?\nEl cliente acepta mantener el capital durante la anualidad establecida y transferir las ganancias generadas en su cuenta para que sean reinvertidas internamente por QLC en cuentas propias. Al finalizar la anualidad, se entrega al cliente el objetivo correspondiente al modelo (40% anual), conforme a los términos contractuales aplicables.\n\nEjemplo conceptual — Capital de 100 USDT\nObjetivo anual: 40% → Incremento objetivo: 40 USDT → Resultado objetivo al finalizar la anualidad: 140 USDT\n\nCaracterísticas principales\n• Objetivo anual: 40%.\n• Permanencia durante la anualidad establecida.\n• Las ganancias generadas se transfieren para su reinversión interna por QLC.\n• Menor flexibilidad durante el compromiso frente al modelo Flexible.\n• Al finalizar la anualidad, se entrega el objetivo correspondiente conforme a los términos contractuales.\n\n¿Para quién está pensado?\n"No necesito retirar mis ganancias periódicamente. Estoy dispuesto a mantener mi participación durante una anualidad para permitir una estrategia de reinversión y capitalización, con un objetivo anual del 40%."',
    detailsContentEn:
      'How does it work?\nThe client agrees to keep the capital during the established annual period and transfer the profits generated in their account so QLC can reinvest them internally in its own accounts. At the end of the annual period, the client receives the model\'s target (40% annual), per the applicable contractual terms.\n\nConceptual example — 100 USDT capital\nAnnual target: 40% → Target increase: 40 USDT → Target result at year end: 140 USDT\n\nMain characteristics\n• Annual target: 40%.\n• Permanence during the established annual period.\n• Profits generated are transferred for internal reinvestment by QLC.\n• Lower flexibility during the commitment compared to the Flexible model.\n• At the end of the annual period, the corresponding target is delivered per the contractual terms.\n\nWho is it designed for?\n"I don\'t need to withdraw my profits periodically. I am willing to maintain my participation during an annual period to allow a reinvestment and capitalization strategy, with a 40% annual target."',
    isActive: true,
  },
];

(async () => {
  for (const u of updates) {
    const { key, ...data } = u;
    const existing = await prisma.model.findUnique({ where: { key } });
    if (!existing) {
      console.log('SKIP (not found):', key);
      continue;
    }
    await prisma.model.update({ where: { key }, data });
    console.log('UPDATED', key);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
