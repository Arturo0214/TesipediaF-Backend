import mongoose from 'mongoose';

const visitSchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      required: true,
    },
    referrer: {
      type: String,
      default: 'Direct',
    },
    path: {
      type: String,
      required: true,
    },
    // Cookie persistente del visitante (se enviaba pero el modelo la descartaba)
    cookieId: {
      type: String,
      default: null,
      index: true,
    },
    // Identificador persistente del visitante (compartido con los eventos)
    visitorId: {
      type: String,
      default: '',
      index: true,
    },
    // Fuente/origen detectado del visitante
    source: {
      type: String,
      default: '',
    },
    geoLocation: {
      city: String,
      region: String,
      country: String,
      org: String,
      location: {
        type: String,
        default: null
      }
    }
  },
  { timestamps: true }
);

// Índice para búsquedas por IP
visitSchema.index({ ip: 1 });
// Índice para búsquedas por fecha
visitSchema.index({ createdAt: -1 });
// TTL Index: elimina automáticamente visitas con más de 30 días
visitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const Visit = mongoose.model('Visit', visitSchema);

export default Visit;