/*
 * Almacenamiento de las DOS guías de uso (ADMIN / CLIENTE) — CORRECCIÓN 27.
 * Son los ÚNICOS PDFs que viven en Cloudinary (recurso "raw"); cualquier
 * otro documento/contrato/estado de cuenta sigue en Google Drive.
 */
const { uploadBuffer, destroyAsset, FOLDERS } = require('../config/cloudinary');

async function uploadGuidePdf(buffer, publicId) {
  const result = await uploadBuffer(buffer, { folder: FOLDERS.GUIDES, resourceType: 'raw', publicId });
  return { url: result.secure_url, publicId: result.public_id, bytes: result.bytes };
}

async function deleteGuidePdf(publicId) {
  return destroyAsset(publicId, 'raw');
}

module.exports = { uploadGuidePdf, deleteGuidePdf };
