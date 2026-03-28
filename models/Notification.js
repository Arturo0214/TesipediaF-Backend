import mongoose from 'mongoose';

// Tipos de notificaciones permitidos
const NOTIFICATION_TYPES = [
  'visita',
  'cotizacion',
  'pedido',
  'entrega',
  'mensaje',
  'pago',
  'proyecto',
  'whatsapp',   // Mensajes entrantes de WhatsApp (leads)
  'lead',       // Nuevo lead creado / lead actualizado
  'alerta',
  'info',
];

// Prioridades sugeridas para ordenarlas visualmente
const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'normal'];

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  data: {
    type: Object,
    default: {}, // Información adicional (por ejemplo: { paymentId: 'abc123' })
  },
  link: {
    type: String,
    default: null, // Enlace opcional para redirigir en el frontend
  },
  priority: {
    type: String,
    enum: NOTIFICATION_PRIORITIES,
    default: 'low', // Bajo por defecto
  },
  isRead: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;