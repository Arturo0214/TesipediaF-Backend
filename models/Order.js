import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // cliente que hizo el pedido
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // redactor
      default: null,
    },
    quoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quote',
      default: null, // si proviene de una cotización
    },
    title: {
      type: String,
      required: true,
    },
    studyArea: {
      type: String,
      required: true,
    },
    educationLevel: {
      type: String,
      enum: ['Licenciatura', 'Maestría', 'Doctorado'],
      required: true,
    },
    pages: {
      type: Number,
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    requirements: {
      text: String,
      file: String, // URL a Cloudinary u otro
    },
    deliveryFiles: [
        {
          fileUrl: String,
          uploadedAt: {
            type: Date,
            default: Date.now,
          },
          uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
          },
          comment: String, // 🆕 Comentario opcional del redactor
        },
      ],
    status: {
      type: String,
      enum: ['pendiente', 'asignado', 'en progreso', 'entregado', 'cancelado'],
      default: 'pendiente',
    },
    price: {
      type: Number,
      required: true,
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    paymentDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const Order = mongoose.model('Order', orderSchema);
export default Order;
