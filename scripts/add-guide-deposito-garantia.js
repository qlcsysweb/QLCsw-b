/*
 * Nueva guía "Guía de Uso — Depósito en Garantía" (contenido del documento
 * QLC_Explicacion_Deposito_en_Garantia.docx entregado por QLC), ubicada justo
 * debajo de "Guía de Uso — Cliente": toma el lugar 2 y las guías de cliente
 * que estaban del 2 en adelante bajan un lugar. Idempotente: si la guía ya
 * existe (mismo título), no crea otra ni vuelve a mover el orden.
 *   node scripts/add-guide-deposito-garantia.js
 */
require('dotenv').config();
const prisma = require('../src/config/prisma');

const TITLE_ES = 'Guía de Uso — Depósito en Garantía';
const TITLE_EN = 'Usage Guide — Guarantee Deposit';
const CLIENT_GUIDE_TITLE = 'Guía de Uso — Cliente';

const CONTENT_ES = `<h3>¿Cómo funciona el depósito en garantía?</h3>
<p>El depósito en garantía es el importe que el cliente paga por adelantado para establecer el periodo de servicio.</p>
<p>La particularidad del modelo QLC es que la rentabilidad se genera directamente dentro de la cuenta del cliente en el exchange. Por esta razón, el depósito en garantía funciona como referencia y garantía de que los servicios de QLC podrán ser pagados con la rentabilidad que se genere en la propia cuenta del cliente.</p>

<h3>Ejemplo sencillo</h3>
<p>Supongamos que el cliente realiza un depósito en garantía de <strong>20 USDT</strong>.</p>
<ol class="qlc-guide-flow">
  <li>Inicio del periodo</li>
  <li>El cliente deposita 20 USDT en garantía</li>
  <li>QLC ejecuta la estrategia en la cuenta del cliente</li>
  <li>La rentabilidad se genera directamente en la cuenta del cliente</li>
  <li>Cuando la rentabilidad acumulada alcanza 20 USDT</li>
  <li>Se alcanza el importe equivalente al depósito en garantía</li>
  <li>Se realiza el corte del periodo y se genera el estado de cuenta</li>
</ol>
<p>Es decir, los 20 USDT de depósito en garantía no representan una rentabilidad que QLC tenga que generar fuera de la cuenta del cliente. El objetivo es que la propia cuenta del cliente genere una rentabilidad equivalente a esos 20 USDT.</p>

<h3>¿Qué sucede después?</h3>
<p>Una vez realizado el corte, el cliente puede decidir libremente si desea continuar con el servicio.</p>
<h4>Si desea renovar:</h4>
<ul>
  <li>Se genera y se entrega el estado de cuenta correspondiente al periodo anterior.</li>
  <li>Después, para iniciar un nuevo periodo, el cliente vuelve a completar su depósito en garantía y comienza un nuevo ciclo bajo las mismas condiciones.</li>
</ul>
<h4>Si no desea continuar:</h4>
<ul>
  <li>Simplemente no realiza un nuevo depósito en garantía.</li>
  <li>No existe obligación de renovar, ya que el servicio correspondiente al periodo anterior ya fue pagado por adelantado mediante el depósito en garantía y ese periodo ya quedó concluido con su respectivo corte.</li>
</ul>

<h3>En pocas palabras</h3>
<div class="qlc-guide-notice">Depósito en garantía → generación de rentabilidad en la cuenta del cliente → se alcanza el equivalente al depósito → corte y estado de cuenta → decisión de renovar o no.</div>
<ul>
  <li>Si el cliente renueva, completa nuevamente el depósito en garantía y comienza un nuevo ciclo.</li>
  <li>Si no desea continuar, no deposita nuevamente y simplemente finaliza su participación.</li>
</ul>`;

const CONTENT_EN = `<h3>How does the guarantee deposit work?</h3>
<p>The guarantee deposit is the amount the client pays in advance to establish the service period.</p>
<p>What makes the QLC model different is that returns are generated directly inside the client's account on the exchange. For this reason, the guarantee deposit works as a reference and guarantee that QLC's services can be paid with the returns generated in the client's own account.</p>

<h3>Simple example</h3>
<p>Suppose the client makes a guarantee deposit of <strong>20 USDT</strong>.</p>
<ol class="qlc-guide-flow">
  <li>Start of the period</li>
  <li>The client deposits 20 USDT as a guarantee</li>
  <li>QLC runs the strategy in the client's account</li>
  <li>Returns are generated directly in the client's account</li>
  <li>When the accumulated returns reach 20 USDT</li>
  <li>The amount equivalent to the guarantee deposit is reached</li>
  <li>The period is closed and the statement is generated</li>
</ol>
<p>In other words, the 20 USDT guarantee deposit does not represent a return that QLC has to generate outside the client's account. The goal is for the client's own account to generate returns equivalent to those 20 USDT.</p>

<h3>What happens next?</h3>
<p>Once the period is closed, the client is free to decide whether to continue with the service.</p>
<h4>If they want to renew:</h4>
<ul>
  <li>The statement for the previous period is generated and delivered.</li>
  <li>Then, to start a new period, the client completes their guarantee deposit again and a new cycle begins under the same conditions.</li>
</ul>
<h4>If they do not want to continue:</h4>
<ul>
  <li>They simply do not make a new guarantee deposit.</li>
  <li>There is no obligation to renew, since the service for the previous period was already paid in advance through the guarantee deposit and that period was already concluded with its corresponding closing.</li>
</ul>

<h3>In short</h3>
<div class="qlc-guide-notice">Guarantee deposit → returns generated in the client's account → the deposit equivalent is reached → period closing and statement → decision to renew or not.</div>
<ul>
  <li>If the client renews, they complete the guarantee deposit again and a new cycle begins.</li>
  <li>If they do not want to continue, they do not deposit again and their participation simply ends.</li>
</ul>`;

async function main() {
  const existing = await prisma.guide.findFirst({ where: { titleEs: TITLE_ES } });
  if (existing) {
    console.log(`La guía ya existe (id ${existing.id}); no se hizo ningún cambio.`);
    return;
  }
  const clientGuide = await prisma.guide.findFirst({ where: { titleEs: CLIENT_GUIDE_TITLE, audience: 'CLIENT' } });
  if (!clientGuide) throw new Error('No se encontró la "Guía de Uso — Cliente".');
  const position = clientGuide.displayOrder + 1;

  const created = await prisma.$transaction(async (tx) => {
    // Las guías de cliente que estaban de esa posición en adelante bajan un lugar.
    await tx.guide.updateMany({
      where: { audience: 'CLIENT', displayOrder: { gte: position } },
      data: { displayOrder: { increment: 1 } },
    });
    return tx.guide.create({
      data: {
        titleEs: TITLE_ES,
        titleEn: TITLE_EN,
        descriptionEs: 'Qué es el depósito en garantía, cómo se cubre con la rentabilidad de tu propia cuenta y qué pasa al terminar cada periodo.',
        descriptionEn: 'What the guarantee deposit is, how it is covered by the returns in your own account and what happens at the end of each period.',
        contentEs: CONTENT_ES,
        contentEn: CONTENT_EN,
        audience: 'CLIENT',
        displayOrder: position,
        isActive: true,
      },
    });
  });
  console.log(`Guía creada (id ${created.id}) en la posición ${position}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
