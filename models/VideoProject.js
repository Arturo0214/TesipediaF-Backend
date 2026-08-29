import mongoose from 'mongoose';

// Un "video faceless" del Estudio de Video: guion por escenas + metadata + estado
// del pipeline. Lo puebla el admin (manual o con IA) y lo renderiza un worker local
// (motor edge-tts + imagenes IA + ffmpeg) que corre en la Mac, no en Railway.
const escenaSchema = new mongoose.Schema({
  narracion: { type: String, default: '' }, // lo que dice la voz
  imagen: { type: String, default: '' },    // prompt de la imagen IA de esa escena
}, { _id: false });

const videoProjectSchema = new mongoose.Schema({
  canal: {
    type: String,
    enum: ['spoilers', 'libro-vs-pelicula', 'tiktok'],
    required: true,
    index: true,
  },
  idioma: { type: String, enum: ['es', 'en'], default: 'es' },
  formato: { type: String, enum: ['vertical', 'horizontal'], default: 'vertical' },

  titulo: { type: String, default: '' },
  estiloVisual: { type: String, default: '' },
  escenas: { type: [escenaSchema], default: [] },

  // Metadata para subir a YouTube/TikTok
  descripcion: { type: String, default: '' },
  tags: { type: [String], default: [] },
  hashtags: { type: [String], default: [] },
  thumbnailPrompt: { type: String, default: '' },

  // Pipeline: idea -> guion -> render_pending -> rendering -> rendered -> approved -> published
  status: {
    type: String,
    enum: ['idea', 'guion', 'render_pending', 'rendering', 'rendered', 'approved', 'published', 'error'],
    default: 'guion',
    index: true,
  },

  videoUrl: { type: String, default: '' },     // URL Cloudinary del mp4 renderizado
  thumbnailUrl: { type: String, default: '' },
  duracionSeg: { type: Number, default: 0 },
  publishedUrl: { type: String, default: '' }, // link final en YouTube/TikTok
  error: { type: String, default: '' },

  source: { type: String, enum: ['manual', 'ia'], default: 'manual' },
  renderStartedAt: { type: Date, default: null },
  renderedAt: { type: Date, default: null },
}, { timestamps: true });

const VideoProject = mongoose.model('VideoProject', videoProjectSchema);
export default VideoProject;
