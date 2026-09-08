const multer = require('multer');

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
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

// Solo para imágenes (branding, contenido público, QR de pago) → Cloudinary
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!IMAGE_MIME.includes(file.mimetype)) {
      return cb(new Error('Tipo de archivo no permitido. Solo PNG, JPG, WEBP o GIF.'));
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

module.exports = { uploadDocument, uploadImage, uploadMedia };
