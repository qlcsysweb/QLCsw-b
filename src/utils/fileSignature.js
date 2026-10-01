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

// ARCHIVOS DEL CHAT DE CITAS — fotos y documentos. El tipo se decide por la
// extensión (el navegador manda Content-Types distintos según el sistema, p.
// ej. un .csv llega como "application/vnd.ms-excel" en Windows) y SIEMPRE se
// confirma con el contenido real. Nunca ejecutables ni formatos con macros
// (.docm/.xlsm, .doc/.xls antiguos).
const CHAT_FILE_TYPES = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office', folder: 'word/' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'office', folder: 'xl/' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'office', folder: 'ppt/' },
  txt: { mime: 'text/plain', kind: 'text' },
  csv: { mime: 'text/csv', kind: 'text' },
};

function looksLikeText(b) {
  // Texto real: sin bytes nulos ni caracteres de control binarios.
  for (let i = 0; i < Math.min(b.length, 64 * 1024); i += 1) {
    const c = b[i];
    if (c === 0 || (c < 9 && c !== 0) || (c > 13 && c < 32 && c !== 27)) return false;
  }
  return true;
}

// Devuelve el tipo canónico (mime) del archivo del chat o lanza un error claro.
function assertChatFile(file, { maxBytes, maxLabel }) {
  const ext = String(file.originalname || '').toLowerCase().split('.').pop();
  const type = CHAT_FILE_TYPES[ext];
  if (!type) {
    throw ApiError.badRequest('Formato no permitido. Puedes enviar fotos (JPG, PNG, WEBP) o documentos (PDF, Word, Excel, PowerPoint, TXT o CSV).');
  }
  if (!file.size) throw ApiError.badRequest('Uno de los archivos está vacío.');
  if (file.size > maxBytes) throw ApiError.badRequest(`Cada archivo puede pesar como máximo ${maxLabel}.`);
  const b = file.buffer;
  let ok;
  if (type.kind === 'image' || type.kind === 'pdf') {
    ok = matchesSignature({ buffer: b, mimetype: type.mime });
  } else if (type.kind === 'office') {
    // Office moderno = ZIP con su carpeta interna (word/, xl/ o ppt/) y sin
    // proyecto de macros.
    const head = b.toString('latin1');
    ok = b.length > 30 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 &&
      head.includes(type.folder) && !head.includes('vbaProject.bin');
  } else {
    ok = looksLikeText(b);
  }
  if (!ok) throw ApiError.badRequest('El archivo no corresponde a su formato o está dañado.');
  return type.mime;
}

module.exports = { SAFE_FILE_MIME, matchesSignature, assertSafeFiles, CHAT_FILE_TYPES, assertChatFile };
