import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.Mixed, // Puede ser ObjectId o String (publicId)
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
      url: String,      // URL del archivo en Cloudinary u otro servicio
      fileName: String, // nombre original del archivo
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
    }
  },
  { timestamps: true }
);

const Message = mongoose.model('Message', messageSchema);
export default Message;