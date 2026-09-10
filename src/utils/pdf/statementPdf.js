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

function generateStatementPdf({ client, identifier, statement }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#0d131a').text('QUANTUM LIQUIDITY CAPITAL', { align: 'center' });
    doc.fontSize(11).fillColor('#5b6b7a').text('Estado de cuenta', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#0d131a');
    doc.text(`Cliente: ${client.firstName} ${client.lastName}`);
    if (identifier) doc.text(`Subcuenta/API: ${identifier}`);
    doc.text(`Periodo: ${formatDate(statement.periodStart)} – ${formatDate(statement.periodEnd)}`);
    doc.text(`Fecha de emisión: ${formatCdmx(new Date())}`);
    doc.moveDown(1);

    doc.fontSize(13).text('Resumen', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10);
    doc.text(`Saldo inicial: ${statement.startingBalance} USDT`);
    doc.text(`Saldo final: ${statement.endingBalance} USDT`);
    doc.text(`Resultado del periodo: ${statement.resultAmount} USDT`);
    doc.text(`Rendimiento: ${statement.resultPercentage}%`);
    doc.text(`Comisión: ${statement.commission} USDT`);
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

    doc.fontSize(8).fillColor('#5b6b7a').text(
      'Documento generado automáticamente por QLC a partir de la información capturada por el equipo administrativo.',
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generateStatementPdf };
