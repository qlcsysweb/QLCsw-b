const driveStorage = require('../services/driveStorageService');
const ApiError = require('./ApiError');

// Evidencias de transferencia interna Bitget (PaymentReportFile). Nunca se
// expone el ID de Drive: el archivo se sirve siempre a través del backend,
// después de validar permisos (admin, o cliente dueño de la subcuenta).
const EVIDENCE_FILE_SELECT = { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true };

async function streamEvidenceFile(res, fileRecord) {
  if (!(await driveStorage.isConfigured())) {
    throw ApiError.serviceUnavailable('No pudimos conectar con el almacenamiento de documentos. Contacta al equipo de QLC.');
  }
  const { stream, mimeType } = await driveStorage.downloadFileFromDrive(fileRecord.driveFileId);
  res.setHeader('Content-Type', fileRecord.mimeType || mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileRecord.fileName)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
}

module.exports = { EVIDENCE_FILE_SELECT, streamEvidenceFile };
