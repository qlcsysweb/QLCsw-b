const multer = require('multer');

const DOCUMENT_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MEDIA_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];

// Para documentos (contratos, documentos de cliente, comprobantes de pago) → Google Drive
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!DOCUMENT_MIME.includes(file.mimetype)) {
      return cb(new Error('Tipo de archivo no permitido. Solo PDF, PNG, JPG o WEBP.'));
    }
    cb(null, true);
  },
});

// Multimedia del sitio público (imágenes + video del logo/secciones) → Cloudinary
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!MEDIA_MIME.includes(file.mimetype)) {
      return cb(new Error('Tipo de archivo no permitido. Solo PNG, JPG, WEBP, GIF, MP4 o WEBM.'));
    }
    cb(null, true);
  },
});

// Archivos de un CASO de soporte: cualquier tipo de archivo, con un único
// límite real de servidor de 5 MB (multer corta la subida al rebasarlo, no
// depende de la validación del navegador).
const ApiError = require('../utils/ApiError');
const MAX_CASE_FILE_BYTES = 5 * 1024 * 1024;
const caseFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CASE_FILE_BYTES, files: 1 },
});

function singleCaseFile(req, res, next) {
  caseFileUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest('El archivo supera el límite permitido de 5 MB.'));
    }
    return next(ApiError.badRequest('No se pudo procesar el archivo adjunto.'));
  });
}

// PDF del ESTADO DE CUENTA cargado por el admin (se guarda en Drive y se
// adjunta al correo del cliente). Solo PDF, hasta 15 MB.
const MAX_STATEMENT_PDF_BYTES = 15 * 1024 * 1024;
const statementPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_STATEMENT_PDF_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(ApiError.badRequest('El estado de cuenta debe ser un archivo PDF.'));
    }
    cb(null, true);
  },
});

function singleStatementPdf(req, res, next) {
  statementPdfUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest('El PDF del estado de cuenta supera el límite de 15 MB.'));
    }
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest('No se pudo procesar el PDF adjunto.'));
  });
}

// EVIDENCIA de transferencia interna Bitget: hasta 5 archivos por reporte,
// solo imágenes (JPG/PNG/WEBP) o PDF, 5 MB cada uno (mismo límite que los
// archivos de casos). Campo multipart: "files".
const EVIDENCE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EVIDENCE_BYTES, files: MAX_EVIDENCE_FILES },
  fileFilter: (req, file, cb) => {
    if (!EVIDENCE_MIME.includes(file.mimetype)) {
      return cb(ApiError.badRequest('Formato de evidencia no permitido. Solo JPG, PNG, WEBP o PDF.'));
    }
    cb(null, true);
  },
});

function evidenceFiles(req, res, next) {
  evidenceUpload.array('files', MAX_EVIDENCE_FILES)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest('Cada archivo de evidencia puede pesar como máximo 5 MB.'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(ApiError.badRequest('Puedes adjuntar como máximo 5 archivos de evidencia.'));
    }
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest('No se pudo procesar la evidencia adjunta.'));
  });
}

// ADJUNTOS de mensajes admin→cliente: hasta 5 archivos (imágenes o PDF),
// 10 MB cada uno. Campo multipart: "files". Nunca ejecutables.
const MAX_MESSAGE_FILES = 5;
const MAX_MESSAGE_FILE_BYTES = 10 * 1024 * 1024;
const messageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MESSAGE_FILE_BYTES, files: MAX_MESSAGE_FILES },
  fileFilter: (req, file, cb) => {
    if (!EVIDENCE_MIME.includes(file.mimetype)) {
      return cb(ApiError.badRequest('Formato de archivo no permitido. Solo JPG, PNG, WEBP o PDF.'));
    }
    cb(null, true);
  },
});

function messageFiles(req, res, next) {
  messageUpload.array('files', MAX_MESSAGE_FILES)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest('Cada archivo puede pesar como máximo 10 MB.'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(ApiError.badRequest('Puedes adjuntar como máximo 5 archivos.'));
    }
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest('No se pudieron procesar los archivos adjuntos.'));
  });
}

// ARCHIVO del chat de citas (cliente o admin): uno por mensaje, foto o
// documento, máx. 10 MB. Campo multipart: "file". El tipo y el contenido se
// validan en utils/fileSignature.assertChatFile.
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MESSAGE_FILE_BYTES, files: 1 },
});

function chatFile(req, res, next) {
  chatUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest('Cada archivo puede pesar como máximo 10 MB.'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(ApiError.badRequest('Adjunta un solo archivo por mensaje.'));
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest('No se pudieron procesar los archivos adjuntos.'));
  });
}

module.exports = {
  chatFile,
  messageFiles,
  MAX_MESSAGE_FILE_BYTES,
  uploadDocument,
  uploadMedia,
  singleCaseFile,
  singleStatementPdf,
  evidenceFiles,
  EVIDENCE_MIME,
  MAX_EVIDENCE_FILES,
  MAX_EVIDENCE_BYTES,
  MAX_CASE_FILE_BYTES,
};
