import mongoose from 'mongoose';

const googleCalendarTokenSchema = new mongoose.Schema({
  adminKey: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    // 'arturo', 'sandy', 'hugo', etc.
  },
  adminLabel: {
    type: String,
    default: '',
  },
  googleEmail: {
    type: String,
    default: '',
  },
  accessToken: {
    type: String,
    required: true,
  },
  refreshToken: {
    type: String,
    default: null,
  },
  expiryDate: {
    type: Number,
    default: null,
  },
  // Si es true, proyectos y pagos se sincronizan automáticamente a este calendario
  autoSync: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

export default mongoose.model('GoogleCalendarToken', googleCalendarTokenSchema);
