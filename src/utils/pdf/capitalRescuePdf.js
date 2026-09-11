/*
 * CORRECCIÓN 4 — Estado de Cuenta / Comprobante de Operación del ciclo de
 * Capital Temporal para Rescate. Se genera al finalizar (registrar la
 * remuneración), con la misma presentación profesional QLC del resto de
 * PDFs del sistema (contrato, estado de cuenta por subcuenta).
 */
const PDFDocument = require('pdfkit');
const { formatCdmx } = require('../timezone');

function formatDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date instanceof Date ? date : new Date(date)
  );
}

function generateCapitalRescuePdf({ client, invitation, participation }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const items = participation.distribution?.items || [];
    const days =
      participation.depositConfirmedAt && participation.usageEndedAt
        ? Math.max(1, Math.round((new Date(participation.usageEndedAt) - new Date(participation.depositConfirmedAt)) / 86400000))
        : 0;

    doc.fontSize(18).fillColor('#0d131a').text('QUANTUM LIQUIDITY CAPITAL', { align: 'center' });
    doc.fontSize(11).fillColor('#5b6b7a').text('Estado de Cuenta / Comprobante de Operación', { align: 'center' });
    doc.fontSize(10).fillColor('#5b6b7a').text('Capital Temporal para Rescate', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#0d131a');
    doc.text(`Cliente: ${client.firstName} ${client.lastName}`);
    doc.text(`Operación: Capital Temporal para Rescate`);
    doc.text(`Fecha de inicio: ${formatDate(participation.depositConfirmedAt)}`);
    doc.text(`Fecha de finalización: ${formatDate(participation.usageEndedAt)}`);
    doc.moveDown(1);

    doc.fontSize(13).text('Capital aportado y devuelto', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10);
    items.forEach((item) => {
      doc.text(
        `${item.apiSubaccount?.identifier || 'Subcuenta sin identificador'} — Aportado: ${item.amount} USDT · Devuelto: ${item.amount} USDT`
      );
    });
    doc.text(`TOTAL: ${participation.participationAmount} USDT aportado y devuelto`);
    doc.moveDown(1);

    doc.fontSize(13).text('Remuneración', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10);
    doc.text(`Tasa diaria: ${invitation.dailyRate}%`);
    doc.text(`Periodo: ${days} día(s)`);
    doc.text(`Remuneración generada: ${participation.remunerationAmount ?? 0} USDT`);
    doc.text(`Wallet de pago: ${participation.remunerationWallet || '—'}`);
    doc.text(`Hash de transferencia: ${participation.remunerationTxHash || '—'}`);
    doc.moveDown(1);

    doc.fontSize(10).fillColor('#5b6b7a').text(
      'El capital principal se retiró exactamente de las cuentas y por los montos indicados. La remuneración no forma parte de estos retiros y fue transferida de manera independiente a la wallet registrada del cliente.'
    );
    doc.moveDown(1.5);

    doc.fillColor('#0d131a').text('Estado de la operación: FINALIZADA', { align: 'left' });
    doc.moveDown(1);
    doc.text('_______________________________', { align: 'left' });
    doc.text('Firma/validación QLC', { align: 'left' });
    doc.moveDown(0.5);

    doc.fontSize(8).fillColor('#5b6b7a').text(
      `Documento generado electrónicamente por QLC. Fecha y hora de generación: ${formatCdmx(new Date())} (CDMX).`,
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generateCapitalRescuePdf };
