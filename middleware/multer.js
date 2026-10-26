import multer from 'multer';
import path from 'path';

const storage = multer.memoryStorage();

// Extensiones permitidas (documentos, hojas, presentaciones, imágenes, audio, video, comprimidos)
const ALLOWED_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods|odp|pages|key|numbers|jpe?g|png|gif|webp|heic|bmp|tiff?|svg|zip|rar|7z|tar|gz|ogg|opus|mp3|m4a|aac|wav|flac|mp4|m4v|mov|mpe?g|webm|mkv|avi)$/i;

const fileFilter = (req, file, cb) => {
  const name = file.originalname || '';
  if (ALLOWED_EXT.test(name)) return cb(null, true);
  cb(new Error(`Tipo de archivo no permitido: ${path.extname(name) || file.mimetype || 'desconocido'}`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB (imágenes se comprimen al enviar; documentos grandes ya pasan)
});

export default upload;
