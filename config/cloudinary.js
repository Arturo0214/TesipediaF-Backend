import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Compresión automática al subir (ahorra almacenamiento) ──
// Cloudinary guarda por defecto el archivo TAL CUAL (originales pesados). Con una
// "transformación entrante" (transformation en el upload) guarda ya la versión comprimida.
// Solo tocamos IMAGE y VIDEO explícitos; NO tocamos 'auto'/'raw' (documentos, audio, PDFs)
// ni uploads que ya traen su propia transformation/format (para no romper nada).
function conCompresion(options = {}) {
  const o = { ...options };
  if (o.transformation || o.raw_convert || o.format) return o; // respeta lo explícito
  if (o.resource_type === 'image') {
    // limita imágenes gigantes y aplica calidad inteligente (mismo formato, mucho menos peso)
    o.transformation = [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto:good' }];
  } else if (o.resource_type === 'video') {
    // baja el bitrate del video guardado sin cambiar su geometría
    o.transformation = [{ quality: 'auto', width: 1080, crop: 'limit' }];
  }
  return o;
}

// Envolvemos upload y upload_stream para que TODA subida de imagen/video se comprima,
// sin editar cada controlador.
const _upload = cloudinary.uploader.upload.bind(cloudinary.uploader);
cloudinary.uploader.upload = (file, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  return _upload(file, conCompresion(options || {}), callback);
};
const _uploadStream = cloudinary.uploader.upload_stream.bind(cloudinary.uploader);
cloudinary.uploader.upload_stream = (options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  return _uploadStream(conCompresion(options || {}), callback);
};

export default cloudinary;
