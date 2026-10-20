import mongoose from 'mongoose';

// Reseñas/testimonios de clientes — alimentan la Biblioteca y el contexto de la IA (Sofia)
const resenaSchema = new mongoose.Schema(
  {
    cliente: { type: String, required: true, trim: true },
    // Captura de WhatsApp con la reseña (Cloudinary)
    imagen: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' },
    },
    // Texto de la reseña — extraído automáticamente de la captura con IA (o manual)
    texto: { type: String, trim: true, default: '' },
    calificacion: { type: Number, min: 1, max: 5, default: 5 },
    fuente: {
      type: String,
      enum: ['whatsapp', 'google', 'facebook', 'instagram', 'sitio', 'otro'],
      default: 'whatsapp',
    },
    servicio: { type: String, trim: true, default: '' }, // ej. "Tesis de maestría en derecho"
    destacada: { type: Boolean, default: false }, // las destacadas entran al contexto de la IA
    visible: { type: Boolean, default: true },
    fecha: { type: Date, default: Date.now }, // fecha real de la reseña (editable)
    capturadaPor: { type: String, default: '' },
  },
  { timestamps: true }
);

const Resena = mongoose.model('Resena', resenaSchema);
export default Resena;
