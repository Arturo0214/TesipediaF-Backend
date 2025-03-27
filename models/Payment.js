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
    enum: ['pendiente', 'exitoso', 'fallido'],
    default: 'pendiente',
  },
  transactionId: String,
}, {
  timestamps: true,
});

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
