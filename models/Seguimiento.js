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

const seguimientoSchema = new mongoose.Schema({
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
  // Overrides manuales (opcionales; si están vacíos se usa el dato en vivo del pago/proyecto)
  vendedor: { type: String, default: '' },
  fechaEntrega: { type: Date, default: null },
  estado: {
    type: String,
    enum: ['sin_gestion', 'en_gestion', 'promesa_pago', 'al_corriente', 'liquidado', 'incobrable'],
    default: 'sin_gestion',
  },
  notas: [notaSchema],
  archivos: [archivoSchema],
}, { timestamps: true });

// Un seguimiento por pago y uno por proyecto (parciales para permitir null)
seguimientoSchema.index({ payment: 1 }, { unique: true, partialFilterExpression: { payment: { $type: 'objectId' } } });
seguimientoSchema.index({ project: 1 }, { unique: true, partialFilterExpression: { project: { $type: 'objectId' } } });

const Seguimiento = mongoose.model('Seguimiento', seguimientoSchema);
export default Seguimiento;
