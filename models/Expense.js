import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: [
      'claude_api',       // Consumo de API de Claude/Anthropic
      'meta_ads',         // Campañas de Facebook/Instagram
      'google_ads',       // Campañas de Google Ads
      'netlify',          // Hosting frontend
      'railway',          // Hosting backend
      'comision_vendedor', // 20% comisión al vendedor
      'turnitin',         // $150 MXN escáner Turnitin
      'antiplagio_ia',    // $100 MXN escáner anti-IA
      'dominio',          // Dominio web
      'cloudinary',       // Almacenamiento de archivos
      'stripe_fees',      // Comisiones de Stripe
      'paypal_fees',      // Comisiones de PayPal
      'otro',             // Otros gastos operativos
    ],
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'MXN',
  },
  // Para vincular gastos a una venta/proyecto específico
  relatedPayment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    default: null,
  },
  relatedProject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null,
  },
  // Período del gasto (ej: ciclo de facturación mensual)
  period: {
    month: { type: Number }, // 0-11
    year: { type: Number },
  },
  // Para gastos recurrentes
  isRecurring: {
    type: Boolean,
    default: false,
  },
  recurringInterval: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly', null],
    default: null,
  },
  // Fecha efectiva del gasto
  date: {
    type: Date,
    default: Date.now,
  },
  // Quién registró el gasto
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Para gastos automáticos (API-based)
  isAutomatic: {
    type: Boolean,
    default: false,
  },
  source: {
    type: String,
    enum: ['manual', 'api', 'calculated'],
    default: 'manual',
  },
  // Metadata adicional (ej: datos de la API, IDs de campaña, etc.)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Índices para consultas eficientes
expenseSchema.index({ category: 1, date: -1 });
expenseSchema.index({ 'period.year': 1, 'period.month': 1 });
expenseSchema.index({ relatedPayment: 1 });
expenseSchema.index({ relatedProject: 1 });

const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
