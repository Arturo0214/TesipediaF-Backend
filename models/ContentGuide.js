import mongoose from 'mongoose';

// Loop de contenido/SEO (#3): cada bloque de trabajo vendido por carrera se
// convierte (anonimizado y agregado) en una guía publicable que alimenta la
// landing programática de esa carrera → más leads orgánicos de esa carrera.
const contentGuideSchema = new mongoose.Schema(
  {
    carrera: { type: String, required: true, index: true }, // nombre display (ej. "Enfermería")
    slug: { type: String, required: true, unique: true },   // matchea landing: "tesis-de-enfermeria"
    area: { type: String, default: '' },
    title: { type: String, required: true },
    intro: { type: String, default: '' },
    sections: [{ heading: String, body: String }],
    faqs: [{ q: String, a: String }],
    keywords: [String],
    // Estadísticas anonimizadas del corpus que originó la guía
    stats: {
      quotesVendidas: Number,
      avgPaginas: Number,
      ticketMediana: Number,
      temasTop: [String],
    },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    aiEnhanced: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const ContentGuide = mongoose.models.ContentGuide || mongoose.model('ContentGuide', contentGuideSchema);
export default ContentGuide;
