import mongoose from 'mongoose';

// Cuenta de Instagram vigilada por el radar de competencia.
// Debe ser business/creator para que Business Discovery pueda leerla.
const competitorSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    active: { type: Boolean, default: true },
    notes: { type: String, default: '' },
    // Último snapshot del escaneo (para mostrar sin re-escanear)
    lastScan: {
        followers: Number,
        mediaCount: Number,
        scannedAt: Date,
    },
}, { timestamps: true });

const Competitor = mongoose.model('Competitor', competitorSchema);
export default Competitor;
