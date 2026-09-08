/*
 * Almacenamiento de IMÁGENES (logo, branding, QR, recursos visuales de la
 * página pública) en Cloudinary. Cloudinary NUNCA se usa para PDFs ni
 * documentos — eso vive en Google Drive (ver documentStorage.js).
 */
const { uploadBuffer, destroyAsset, FOLDERS } = require('../config/cloudinary');

async function uploadImage(buffer, { folder = FOLDERS.PUBLIC, publicId } = {}) {
  const result = await uploadBuffer(buffer, { folder, resourceType: 'image', publicId });
  return {
    url: result.secure_url,
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes,
  };
}

async function deleteImage(publicId) {
  return destroyAsset(publicId, 'image');
}

module.exports = { uploadImage, deleteImage, FOLDERS };
