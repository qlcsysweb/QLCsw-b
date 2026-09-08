/*
 * Almacenamiento de multimedia del sitio público (imágenes y video) en
 * Cloudinary. Mismo Cloudinary que imageStorage.js, pero soporta también
 * resource_type "video" (logo animado, recursos visuales de secciones).
 * Documentos/PDF siguen viviendo exclusivamente en Google Drive.
 */
const { uploadBuffer, destroyAsset, FOLDERS } = require('../config/cloudinary');

const VIDEO_MIME = ['video/mp4', 'video/webm'];

function resourceTypeFor(mimetype) {
  return VIDEO_MIME.includes(mimetype) ? 'video' : 'image';
}

function mediaTypeFor(mimetype) {
  return VIDEO_MIME.includes(mimetype) ? 'VIDEO' : 'IMAGE';
}

function folderFor(mimetype, { isLogo = false } = {}) {
  if (isLogo) return FOLDERS.BRANDING;
  return VIDEO_MIME.includes(mimetype) ? FOLDERS.PUBLIC_VIDEOS : FOLDERS.PUBLIC_IMAGES;
}

async function uploadMedia(buffer, mimetype, { isLogo = false } = {}) {
  const resourceType = resourceTypeFor(mimetype);
  const folder = folderFor(mimetype, { isLogo });
  const result = await uploadBuffer(buffer, { folder, resourceType });
  return {
    url: result.secure_url,
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes,
    type: mediaTypeFor(mimetype),
  };
}

async function deleteMedia(publicId, type) {
  return destroyAsset(publicId, type === 'VIDEO' ? 'video' : 'image');
}

module.exports = { uploadMedia, deleteMedia, resourceTypeFor, mediaTypeFor };
