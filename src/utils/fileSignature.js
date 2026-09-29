const ApiError = require('./ApiError');

// Tipos seguros admitidos para evidencias y adjuntos (nunca ejecutables).
const SAFE_FILE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// Firma real del contenido (no se confía solo en el Content-Type que manda
// el navegador): JPEG, PNG, WEBP o PDF.
function matchesSignature(file) {
  const b = file.buffer;
  if (!b || b.length < 12) return false;
  switch (file.mimetype) {
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    case 'application/pdf':
      return b.toString('ascii', 0, 5) === '%PDF-';
    default:
      return false;
  }
}

// Valida una lista de archivos subidos (tipo, tamaño y firma real).
function assertSafeFiles(files, { maxBytes, maxLabel }) {
  for (const file of files || []) {
    if (!SAFE_FILE_MIME.includes(file.mimetype)) {
      throw ApiError.badRequest('Formato de archivo no permitido. Solo JPG, PNG, WEBP o PDF.');
    }
    if (file.size === 0) throw ApiError.badRequest('Uno de los archivos está vacío.');
    if (file.size > maxBytes) throw ApiError.badRequest(`Cada archivo puede pesar como máximo ${maxLabel}.`);
    if (!matchesSignature(file)) throw ApiError.badRequest('Uno de los archivos no es una imagen o PDF válido.');
  }
}

module.exports = { SAFE_FILE_MIME, matchesSignature, assertSafeFiles };
