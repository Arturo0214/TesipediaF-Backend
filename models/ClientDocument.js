import mongoose from 'mongoose';

/**
 * Documento protegido del portal del cliente.
 * El cliente NUNCA recibe el PDF — solo imágenes renderizadas en servidor.
 * - BLOQUEADO (antes de pagar): `pages` = imágenes con marca de agua, SIN referencias.
 * - LIBERADO (ya pagó): `cleanPages` = imágenes limpias de todo + `original` descargable.
 * Las imágenes se suben a Cloudinary como `type: authenticated` (no accesibles por URL
 * adivinable); el portal entrega URLs firmadas solo al dueño autenticado.
 */
const pageSchema = new mongoose.Schema({
  publicId: String,          // Cloudinary public_id (resource_type image, type authenticated)
  width: Number,
  height: Number,
  page: Number,              // número de página original
}, { _id: false });

const clientDocumentSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    quote: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneratedQuote', default: null, index: true },

    title: { type: String, default: 'Documento' },
    status: { type: String, enum: ['processing', 'locked', 'unlocked', 'error'], default: 'processing', index: true },
    error: { type: String, default: '' },

    watermark: { type: String, default: '' },
    numPages: { type: Number, default: 0 },
    refStartPage: { type: Number, default: null },  // dónde empezaban las referencias (null si no se detectó)

    pages: { type: [pageSchema], default: [] },         // preview bloqueado (marca de agua, sin referencias)
    cleanPages: { type: [pageSchema], default: [] },    // imágenes limpias (tras liberar)
    original: {                                         // PDF original limpio (para descarga al liberar)
      publicId: { type: String, default: '' },
      bytes: { type: Number, default: 0 },
    },
    viewPdf: {                                          // PDF de VISTA protegido (marca agua + censura + sin referencias)
      publicId: { type: String, default: '' },
      bytes: { type: Number, default: 0 },
    },

    uploadedBy: { type: String, default: '' },
    unlockedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const ClientDocument = mongoose.model('ClientDocument', clientDocumentSchema);
export default ClientDocument;
