import mongoose from 'mongoose';

const installmentSchema = new mongoose.Schema({
  number: Number,
  amount: Number,
  dueDate: Date,
  label: String,
  status: {
    type: String,
    enum: ['pending', 'paid'],
    default: 'pending',
  },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
  },
  method: {
    type: String,
    enum: ['stripe', 'paypal', 'transferencia', 'efectivo', 'mercadolibre', 'manual'],
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
  // Referencia al proyecto vinculado
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null,
  },
  // ===== Campos para pagos manuales =====
  isManual: {
    type: Boolean,
    default: false,
  },
  clientName: {
    type: String,
    default: '',
  },
  clientEmail: {
    type: String,
    default: '',
  },
  clientPhone: {
    type: String,
    default: '',
  },
  title: {
    type: String,
    default: '',
  },
  esquemaPago: {
    type: String,
    default: 'unico',
  },
  paymentDate: {
    type: Date,
    default: null,
  },
  schedule: [installmentSchema],
  notes: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
