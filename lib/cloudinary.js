import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// URL firmada para un archivo privado (raw authenticated) — se entrega solo tras pago verificado.
export function signedRawUrl(publicId) {
  if (!publicId) return null;
  return cloudinary.url(publicId, {
    resource_type: 'raw', type: 'authenticated', sign_url: true, secure: true,
  });
}

export default cloudinary;
