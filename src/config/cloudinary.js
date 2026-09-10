const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Cloudinary es para imágenes (logo, branding, QR, recursos visuales de la
// web pública). Los documentos/contratos/estados de cuenta viven en Google
// Drive (ver services/documentStorage.js). ÚNICA EXCEPCIÓN (CORRECCIÓN 27):
// las dos guías de uso (ADMIN/CLIENTE) descargables desde el dashboard —
// esos dos PDFs, y solo esos, se almacenan aquí como recurso "raw".
const FOLDERS = {
  PUBLIC: 'qlc/public',
  BRANDING: 'qlc/branding',
  PAYMENTS_QR: 'qlc/payments-qr',
  WALLET_QR: 'qlc/wallet-qr',
  PUBLIC_IMAGES: 'qlc/public/images',
  PUBLIC_VIDEOS: 'qlc/public/videos',
  GUIDES: 'qlc/guides',
};

function uploadBuffer(buffer, { folder, resourceType = 'auto', publicId } = {}) {
  const streamifier = require('streamifier');
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType, public_id: publicId, overwrite: true },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

function destroyAsset(publicId, resourceType = 'image') {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = { cloudinary, uploadBuffer, destroyAsset, FOLDERS };
