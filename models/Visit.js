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
    geoLocation: {
      city: String,
      region: String,
      country: String,
      org: String,
      coordinates: {
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

const Visit = mongoose.model('Visit', visitSchema);

export default Visit;