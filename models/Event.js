import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema(
  {
    // Identificador del visitante (sessionId generado en frontend — vive por sesión de navegador)
    sessionId: { type: String, required: true, index: true },
    // Identificador PERSISTENTE del visitante (cookie tsp_vid, sobrevive entre sesiones)
    visitorId: { type: String, default: '', index: true },
    // Fuente/origen detectado del visitante (meta, google_ads, google_organic, instagram, referral, direct, etc.)
    source: { type: String, default: '' },
    // Atribución de campaña (first-touch capturado en el navegador)
    utm: {
      source: { type: String, default: '' },
      medium: { type: String, default: '' },
      campaign: { type: String, default: '' },
      content: { type: String, default: '' },
      term: { type: String, default: '' },
      fbclid: { type: String, default: '' },
      gclid: { type: String, default: '' },
    },
    // Página de aterrizaje (primera ruta de la sesión) y referrer externo capturado en cliente
    landing: { type: String, default: '' },
    // Tipo de evento: click, scroll, cta, chat, pageview, form, custom
    type: { type: String, required: true, index: true },
    // Categoría del evento (e.g., 'navigation', 'cta', 'chat', 'form', 'engagement')
    category: { type: String, default: 'general' },
    // Acción específica (e.g., 'click_whatsapp', 'open_chat', 'submit_form')
    action: { type: String, required: true },
    // Label descriptivo (e.g., 'Botón WhatsApp Hero', 'CTA Cotizar')
    label: { type: String, default: '' },
    // Valor numérico opcional (e.g., scroll %, time on page in seconds)
    value: { type: Number, default: null },
    // Página donde ocurrió el evento
    page: { type: String, required: true },
    // Elemento HTML que generó el evento (selector CSS simplificado)
    element: { type: String, default: '' },
    // Metadatos adicionales
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Info del visitante
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    // Referrer de la sesión
    referrer: { type: String, default: '' },
    // Dispositivo (calculado en backend)
    device: { type: String, enum: ['desktop', 'mobile', 'tablet'], default: 'desktop' },
  },
  { timestamps: true }
);

// Índice compuesto para queries de analytics
eventSchema.index({ createdAt: -1 });
eventSchema.index({ type: 1, createdAt: -1 });
eventSchema.index({ page: 1, action: 1 });
eventSchema.index({ sessionId: 1, createdAt: -1 });
eventSchema.index({ visitorId: 1, createdAt: -1 });
eventSchema.index({ source: 1, createdAt: -1 });

// TTL: auto-eliminar eventos después de 90 días
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Event = mongoose.model('Event', eventSchema);

export default Event;
