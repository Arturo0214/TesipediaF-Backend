import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.Mixed, // Puede ser ObjectId (usuario) o String (publicId)
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.Mixed, // Puede ser ObjectId (usuario) o String (orderId)
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null, // si está relacionado con un pedido
    },
    text: {
      type: String,
      trim: true,
    },
    attachment: {
      url: String,      // URL del archivo (ej: Cloudinary)
      fileName: String, // Nombre original del archivo
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    senderName: {
      type: String,
      required: true,
    },
    senderIP: {         // 🔥 IP del remitente
      type: String,
      default: null,
    },
    geoLocation: {      // 🔥 Información geográfica
      city: String,
      region: String,
      country: String,
      org: String,
      coordinates: {    // 🔥 Coordenadas (latitud,longitud)
        type: String,
        default: null
      }
    },
    expiresAt: {                 // 🔥 Nuevo campo para expiración
      type: Date,
      default: null,             // Solo se llena si es un mensaje público
    }
  },
  { timestamps: true } // createdAt y updatedAt automáticos
);

// 🔥 TTL index: si expiresAt tiene valor, Mongo elimina el mensaje después de la fecha
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Message = mongoose.model('Message', messageSchema);

export default Message;