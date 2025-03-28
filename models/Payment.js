import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  method: {
    type: String,
    enum: ['stripe', 'paypal'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'MXN',
  },
  status: {
    type: String,
    enum: ['pendiente', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pendiente',
  },
  transactionId: {
    type: String,
    required: true,
  },
  // Campos específicos de PayPal
  paypalOrderId: {
    type: String,
  },
  paypalCaptureId: {
    type: String,
  },
  // Campos para reembolsos
  refundId: {
    type: String,
  },
  refundReason: {
    type: String,
  },
  refundStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
  },
}, {
  timestamps: true,
});

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
