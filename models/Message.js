import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    text: {
      type: String,
      trim: true,
    },
    attachment: {
      url: String,
      fileName: String,
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
    senderIP: {
      type: String,
      default: null,
    },
    geoLocation: {
      city: String,
      region: String,
      country: String,
      org: String,
      coordinates: {
        type: String,
        default: null,
      },
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// 🔍 conversationId virtual
messageSchema.virtual('conversationId').get(function () {
  if (this.isPublic) {
    // Para mensajes públicos, usar el ID público como conversationId
    // Si el mensaje lo envía un admin a un usuario público, usar receiver
    // Si el mensaje lo envía un usuario público, usar sender

    // Determinar si el sender es un ObjectId (admin) o un string (ID público)
    const isSenderObjectId = mongoose.Types.ObjectId.isValid(this.sender?.toString());
    const isReceiverObjectId = mongoose.Types.ObjectId.isValid(this.receiver?.toString());

    if (isSenderObjectId && !isReceiverObjectId) {
      // El admin envía a un usuario público
      return this.receiver?.toString();
    } else if (!isSenderObjectId) {
      // El usuario público envía al admin
      return this.sender?.toString();
    }

    // Por defecto, usar sender
    return this.sender?.toString();
  }

  // Para mensajes directos, ordenar IDs y unir con guión
  const ids = [
    this.sender?._id?.toString() || this.sender?.toString(),
    this.receiver?._id?.toString() || this.receiver?.toString()
  ];
  return ids.sort().join('-');
});
messageSchema.set('toJSON', { virtuals: true });
messageSchema.set('toObject', { virtuals: true });

messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Message = mongoose.model('Message', messageSchema);

export default Message;