/*
 * PDF de la conversación de una sesión de chat de 15 minutos — se genera
 * al vuelo a partir de los ChatMessage ya guardados en BD (nunca se sube a
 * Drive ni se guarda un archivo aparte: no hace falta, los mensajes ya
 * persisten y el PDF puede volver a generarse en cualquier momento). Mismo
 * patrón que statementPdf.js/capitalRescuePdf.js (pdfkit).
 */
const PDFDocument = require('pdfkit');
const { formatCdmx } = require('../timezone');

function generateChatSessionPdf({ session, client, messages, participantNames }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#0d131a').text('QUANTUM LIQUIDITY CAPITAL', { align: 'center' });
    doc.fontSize(11).fillColor('#5b6b7a').text('Conversación de chat (sesión de 15 minutos)', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#0d131a');
    doc.text(`Cliente: ${client?.firstName || ''} ${client?.lastName || ''}`.trim());
    doc.text(`Inicio: ${session.startedAt ? formatCdmx(session.startedAt) : '—'}`);
    doc.text(`Fin: ${session.endsAt ? formatCdmx(session.endsAt) : '—'}`);
    doc.moveDown(1);

    doc.fontSize(13).text('Mensajes', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10);

    if (messages.length === 0) {
      doc.fillColor('#5b6b7a').text('No se registraron mensajes en esta sesión.');
    }

    messages.forEach((m) => {
      const name = participantNames[m.senderUserId] || 'Usuario';
      doc.fillColor('#0d131a').text(`${name} — ${formatCdmx(m.createdAt)}`);
      doc.fillColor('#3a4550').text(m.content);
      doc.moveDown(0.6);
    });

    doc.end();
  });
}

module.exports = { generateChatSessionPdf };
