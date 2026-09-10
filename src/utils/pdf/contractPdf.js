/*
 * CORRECCIÓN 23 — genera el PDF del contrato a partir de los datos reales
 * del cliente y del modelo de participación que confirmó, para que pueda
 * descargarlo, imprimirlo, firmarlo y volver a subirlo firmado. No
 * sustituye la posibilidad de que un ADMIN suba manualmente un contrato
 * distinto si hiciera falta (se conserva esa vía).
 */
const PDFDocument = require('pdfkit');
const { formatCdmx } = require('../timezone');

function generateContractPdf({ client, model, identifier, qlcWallet }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#0d131a').text('QUANTUM LIQUIDITY CAPITAL', { align: 'center' });
    doc.fontSize(11).fillColor('#5b6b7a').text('Contrato de participación en modelo de copytrading', {
      align: 'center',
    });
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#0d131a');
    doc.text(`Fecha de emisión: ${formatCdmx(new Date())}`);
    doc.text(`Cliente: ${client.firstName} ${client.lastName}`);
    doc.text(`Correo: ${client.user?.email || ''}`);
    if (client.nationality) doc.text(`Nacionalidad: ${client.nationality}`);
    if (identifier) doc.text(`Subcuenta/API: ${identifier}`);
    doc.moveDown(1);

    if (client.walletAddress || (qlcWallet && qlcWallet.address)) {
      doc.fontSize(13).text('Datos de wallet', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10);
      if (client.walletAddress) {
        doc.text(`Wallet del cliente: ${client.walletAddress}`);
        if (client.walletNetwork) doc.text(`Red: ${client.walletNetwork}`);
      }
      if (qlcWallet && qlcWallet.address) {
        doc.text(`Wallet de depósito QLC (${qlcWallet.currency || 'USDT'}): ${qlcWallet.address}`);
        if (qlcWallet.network) doc.text(`Red: ${qlcWallet.network}`);
      }
      doc.moveDown(1);
    }

    doc.fontSize(13).text('Modelo de participación seleccionado', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).text(model.name || model.key);
    if (model.tagline) doc.fontSize(10).fillColor('#5b6b7a').text(model.tagline);
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#0d131a').text(model.description || '');
    doc.moveDown(0.4);
    if (model.conditions) doc.text(`Condiciones: ${model.conditions}`);
    if (model.period) doc.text(`Periodo: ${model.period}`);
    if (model.percentage) doc.text(`Distribución: ${model.percentage}`);
    if (model.objective) doc.text(`Objetivo: ${model.objective}`);
    doc.moveDown(1.5);

    doc.fontSize(10).text(
      'El cliente reconoce que su capital permanece en su propia cuenta del exchange bajo su titularidad y control. ' +
        'QLC no recibe capital de inversión, no custodia fondos y no ejecuta retiros. La conexión API autorizada ' +
        'permite únicamente la ejecución de la estrategia descrita, sin autorización para retirar fondos.'
    );
    doc.moveDown(2);

    doc.text('_______________________________', { align: 'left' });
    doc.text('Firma del cliente', { align: 'left' });
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#5b6b7a').text(
      'Este documento debe imprimirse, firmarse y cargarse firmado en el sistema para continuar con el proceso de activación.'
    );

    doc.end();
  });
}

module.exports = { generateContractPdf };
