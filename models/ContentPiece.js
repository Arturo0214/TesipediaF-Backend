import mongoose from 'mongoose';

// Pieza del Board de Contenido (antes vivía en localStorage del navegador).
// La pueblan el admin, el radar de competencia y (a futuro) los agentes.
const contentPieceSchema = new mongoose.Schema({
    platform: {
        type: String,
        enum: ['instagram', 'facebook', 'tiktok', 'threads', 'x', 'linkedin'],
        default: 'instagram',
    },
    type: {
        type: String,
        enum: ['reel', 'carousel', 'post', 'story', 'text'],
        default: 'reel',
    },
    status: {
        type: String,
        enum: ['idea', 'draft', 'ready', 'published'],
        default: 'idea',
    },
    caption: { type: String, default: '' },
    hashtags: { type: String, default: '' },
    imagePrompt: { type: String, default: '' },
    reelIdea: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    mediaUrls: { type: [String], default: [] }, // carrusel: varias imágenes (2-10)
    notes: { type: String, default: '' },
    scheduledDate: { type: String, default: '' },
    // Origen de la pieza: manual (admin), radar (competencia) o agente
    source: {
        type: String,
        enum: ['manual', 'radar', 'agent'],
        default: 'manual',
    },
    // Para piezas del radar: post de competencia que la inspiró
    sourceRef: {
        username: String,
        permalink: String,
        likes: Number,
        comments: Number,
    },
    // ── Auto-publicación programada ──
    scheduledFor: { type: Date, default: null, index: true }, // cuándo publicar (fecha real)
    autoPublish: { type: Boolean, default: false },            // el scheduler la debe publicar
    publishedAt: { type: Date, default: null },
    publishResult: {                                            // resultado del último intento
        ok: Boolean,
        postId: String,
        permalink: String,
        error: String,
        at: Date,
    },
}, { timestamps: true });

const ContentPiece = mongoose.model('ContentPiece', contentPieceSchema);
export default ContentPiece;
