import mongoose from 'mongoose';

const cotizarLeadSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre es obligatorio'],
    trim: true
  },
  telefono: {
    type: String,
    required: [true, 'El teléfono es obligatorio'],
    trim: true
  },
  telefono_e164: {
    type: String,
    trim: true
  },
  carrera: {
    type: String,
    required: [true, 'La carrera es obligatoria'],
    trim: true
  },
  nivel_estudios: {
    type: String,
    required: [true, 'El nivel de estudios es obligatorio'],
    trim: true
  },
  tipo_proyecto: {
    type: String,
    required: [true, 'El tipo de proyecto es obligatorio'],
    trim: true
  },
  num_paginas: {
    type: Number,
    min: 1
  },
  fecha_entrega: {
    type: String,
    trim: true
  },
  source: {
    type: String,
    default: 'landing_tesipedia_instagram'
  },
  page: {
    type: String,
    default: '/cotizar'
  },
  // Tracking
  webhook_sent: {
    type: Boolean,
    default: false
  },
  webhook_error: {
    type: String,
    default: null
  },
  estado: {
    type: String,
    enum: ['nuevo', 'contactado', 'cotizado', 'cerrado', 'descartado'],
    default: 'nuevo'
  },
  notas: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index para búsquedas frecuentes
cotizarLeadSchema.index({ telefono: 1 });
cotizarLeadSchema.index({ estado: 1 });
cotizarLeadSchema.index({ createdAt: -1 });

export default mongoose.model('CotizarLead', cotizarLeadSchema);
