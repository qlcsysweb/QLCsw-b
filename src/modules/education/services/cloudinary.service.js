import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../config/prisma.js';
import { cloudinaryConfigured, env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

function credentials() {
  if (!cloudinaryConfigured()) throw new HttpError(503, 'Cloudinary no está configurado en el servidor');
  return { cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret, secure: true };
}

export function uploadBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { ...credentials(), folder: `${env.cloudinary.folder}/${folder}`, resource_type: 'image', overwrite: false },
      (err, result) => (err ? reject(new HttpError(502, `Cloudinary rechazó la imagen: ${err.message}`)) : resolve(result)),
    );
    stream.end(buffer);
  });
}

export async function destroyImage(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId, { ...credentials(), resource_type: 'image' });
  } catch (err) {
    console.error('[cloudinary] no se pudo eliminar', publicId, err.message);
  }
}
