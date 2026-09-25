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

module.exports = { uploadDocument, uploadMedia, singleCaseFile, MAX_CASE_FILE_BYTES };
