import mongoose from 'mongoose';

/**
 * Seguimiento — capa MANUAL de cobranza sobre los pagos/proyectos.
 * NO duplica los datos financieros (esos viven en Payment/Project y se leen en vivo
 * para conciliar). Aquí solo se guarda lo que gestiona el equipo: notas de seguimiento,
 * archivos de conciliación y algunos overrides manuales.
 * Se vincula por `payment` (fila financiera) o por `project` (cliente sin pago registrado).
 */
const notaSchema = new mongoose.Schema({
  texto: { type: String, required: true, trim: true },
  fecha: { type: Date, default: Date.now },
  autor: { type: String, default: '' },
}, { _id: true });

const archivoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String, default: '' },
  nombre: { type: String, default: '' },
  size: { type: Number, default: 0 },
  tipo: { type: String, default: '' },
  subidoPor: { type: String, default: '' },
  subidoEn: { type: Date, default: Date.now },
}, { _id: true });

// Comprobante de pago ligado a UNA parcialidad (installmentIdx = índice en installmentStatuses).
const comprobanteSchema = new mongoose.Schema({
  installmentIdx: { type: Number, required: true },
  url: { type: String, required: true },
  publicId: { type: String, default: '' },
  nombre: { type: String, default: '' },
  size: { type: Number, default: 0 },
  sizeOriginal: { type: Number, default: 0 }, // tamaño antes de comprimir
  tipo: { type: String, default: '' },
  subidoPor: { type: String, default: '' },
  subidoEn: { type: Date, default: Date.now },
}, { _id: true });

// Acuerdo con el lead: correcciones pactadas y/o fecha de entrega comprometida.
// fuente 'manual' = capturado desde el panel; 'fireflies' = extraído por IA de una sesión.
const acuerdoSchema = new mongoose.Schema({
  texto: { type: String, default: '' },          // correcciones / notas del acuerdo
  fechaEntrega: { type: Date, default: null },   // fecha de entrega acordada
  fuente: { type: String, enum: ['manual', 'fireflies'], default: 'manual' },
  meetingId: { type: String, default: '' },
  meetingTitle: { type: String, default: '' },
  meetingDate: { type: Date, default: null },
  autor: { type: String, default: '' },
  creadoEn: { type: Date, default: Date.now },
}, { _id: true });

const seguimientoSchema = new mongoose.Schema({
  // Clave principal del tablero: la cotización pagada (misma fuente que Revenue/Pagos).
  quote: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneratedQuote', default: null, index: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
  // Overrides manuales (opcionales; si están vacíos se usa el dato en vivo del pago/proyecto)
  nombre: { type: String, default: '' },   // nombre editable del cliente (para "S/T" o sin nombre)
  prioritario: { type: Boolean, default: false }, // marcado a mano: sube al inicio del tablero
  vendedor: { type: String, default: '' },
  fechaEntrega: { type: Date, default: null },
  estado: {
    type: String,
    enum: ['sin_gestion', 'en_gestion', 'promesa_pago', 'al_corriente', 'liquidado', 'incobrable'],
    default: 'sin_gestion',
  },
  notas: [notaSchema],
  archivos: [archivoSchema],
  comprobantes: [comprobanteSchema],
  acuerdos: [acuerdoSchema],
}, { timestamps: true });

// Un seguimiento por cotización / pago / proyecto (parciales para permitir null)
seguimientoSchema.index({ quote: 1 }, { unique: true, partialFilterExpression: { quote: { $type: 'objectId' } } });
seguimientoSchema.index({ payment: 1 }, { unique: true, partialFilterExpression: { payment: { $type: 'objectId' } } });
seguimientoSchema.index({ project: 1 }, { unique: true, partialFilterExpression: { project: { $type: 'objectId' } } });

const Seguimiento = mongoose.model('Seguimiento', seguimientoSchema);
export default Seguimiento;
