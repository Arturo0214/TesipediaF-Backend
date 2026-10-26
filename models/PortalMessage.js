import mongoose from 'mongoose';

/**
 * Mensajes del mini-chat del portal: hilo directo entre el CLIENTE y el EQUIPO.
 * Un hilo por cliente (su User). Se ve en el portal (cliente) y en Proyectos (equipo).
 */
const portalMessageSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    from: { type: String, enum: ['client', 'team'], required: true },
    authorName: { type: String, default: '' },     // quién lo escribió (cliente o nombre del asesor)
    text: { type: String, default: '' },
    readByTeam: { type: Boolean, default: false },   // el equipo ya lo vio
    readByClient: { type: Boolean, default: false },  // el cliente ya lo vio
  },
  { timestamps: true }
);

portalMessageSchema.index({ client: 1, createdAt: 1 });

const PortalMessage = mongoose.model('PortalMessage', portalMessageSchema);
export default PortalMessage;
