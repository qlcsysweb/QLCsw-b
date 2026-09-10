/*
 * CORRECCIÓN 14 — genera el PDF del estado de cuenta de una subcuenta/API
 * para un periodo determinado, con presentación profesional QLC.
 */
const PDFDocument = require('pdfkit');
const { formatCdmx } = require('../timezone');

function formatDate(date) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date instanceof Date ? date : new Date(date)
  );
}

function generateStatementPdf({ client, identifier, model, statement }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const commissionAmount = Number(statement.commission || 0);
    const commissionPaid = Boolean(statement.commissionPaid);
    const pendingAmount = commissionAmount > 0 && !commissionPaid ? commissionAmount : 0;

    doc.fontSize(18).fillColor('#0d131a').text('QUANTUM LIQUIDITY CAPITAL', { align: 'center' });
    doc.fontSize(11).fillColor('#5b6b7a').text('Estado de cuenta', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#0d131a');
    doc.text(`Cliente: ${client.firstName} ${client.lastName}`);
    doc.text(`ID de cliente: ${client.id}`);
    if (identifier) doc.text(`Subcuenta/API: ${identifier}`);
    if (model) doc.text(`Modelo: ${model.name || model.key}`);
    doc.text(`Periodo: ${formatDate(statement.periodStart)} – ${formatDate(statement.periodEnd)}`);
    doc.text(`Fecha de emisión: ${formatCdmx(new Date())}`);
    doc.moveDown(1);

    doc.fontSize(13).text('Resumen', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10);
    doc.text(`Capital inicial: ${statement.startingBalance} USDT`);
    doc.text(`Rendimiento generado: ${statement.resultAmount} USDT`);
    doc.text(`Rendimiento % del periodo: ${statement.resultPercentage}%`);
    if (statement.volatility) doc.text(`Volatilidad: ${statement.volatility}`);
    doc.text(`Capital final: ${statement.endingBalance} USDT`);
    if (statement.netResult !== null && statement.netResult !== undefined) {
      doc.text(`Resultado neto: ${statement.netResult} USDT`);
    }
    doc.moveDown(1);

    doc.fontSize(13).text('Comisiones', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10);
    doc.text(`Rendimiento generado: ${statement.resultAmount} USDT`);
    doc.text(`Comisión QLC: ${commissionAmount} USDT`);
    doc.text(`Importe pendiente: ${pendingAmount} USDT`);
    doc.text(`Estado de pago: ${commissionPaid ? 'PAGADO' : 'PENDIENTE'}`);
    doc.moveDown(1);

    if (statement.activityNotes) {
      doc.fontSize(13).text('Actividad del periodo', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).text(statement.activityNotes);
      doc.moveDown(1);
    }

    if (statement.adminNotes) {
      doc.fontSize(13).text('Notas', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).text(statement.adminNotes);
      doc.moveDown(1);
    }

    doc.moveDown(1);
    doc.text('_______________________________', { align: 'left' });
    doc.text('Firma/validación QLC', { align: 'left' });
    doc.moveDown(0.5);

    doc.fontSize(8).fillColor('#5b6b7a').text(
      `Documento generado electrónicamente por QLC a partir de la información capturada por el equipo administrativo. Fecha y hora de generación: ${formatCdmx(new Date())} (CDMX).`,
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generateStatementPdf };
