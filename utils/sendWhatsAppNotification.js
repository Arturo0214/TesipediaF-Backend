/**
 * Utilidad para enviar notificaciones por WhatsApp Business API
 * Usa la API de Meta (Graph) directamente
 */

const WA_PHONE_ID = process.env.WA_PHONE_ID || '978427788691495';
const WA_TOKEN = process.env.WA_TOKEN || '';

// Números de notificación del equipo
const NOTIFICATION_NUMBERS = [
  '525583352096',
  '525561757123',
  '525512478395',
];

/**
 * Enviar un mensaje de texto simple por WhatsApp
 * @param {string} to - Número de destino (con código de país, sin +)
 * @param {string} message - Texto del mensaje
 * @returns {Promise<object>} Respuesta de la API
 */
export const sendWhatsAppText = async (to, message) => {
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: to.replace(/\D/g, ''),
    type: 'text',
    text: { body: message },
  };

  try {
    const response = await fetch(waUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`❌ WhatsApp API error enviando a ${to}:`, errorData);
      return { success: false, error: errorData };
    }

    const result = await response.json();
    console.log(`✅ WhatsApp enviado a ${to}`);
    return { success: true, data: result };
  } catch (err) {
    console.error(`❌ Error enviando WhatsApp a ${to}:`, err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Notificar al equipo cuando Sofia genera/envía una cotización
 * @param {object} quoteData - Datos de la cotización generada
 */
export const notifyQuoteSent = async (quoteData) => {
  const {
    clientName = 'Cliente',
    clientEmail = '',
    clientPhone = '',
    tipoServicio = '',
    tituloTrabajo = '',
    precioConDescuento,
    precioConRecargo,
    precioBase,
    esquemaPago = 'No especificado',
  } = quoteData;

  const precio = precioConDescuento || precioConRecargo || precioBase || 0;
  const precioFormatted = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(precio);

  const message = [
    `📋 *Nueva Cotización Generada por Sofia*`,
    ``,
    `👤 *Cliente:* ${clientName}`,
    clientEmail ? `📧 *Email:* ${clientEmail}` : null,
    clientPhone ? `📱 *Teléfono:* ${clientPhone}` : null,
    ``,
    `📝 *Servicio:* ${tipoServicio}`,
    tituloTrabajo ? `📖 *Título:* ${tituloTrabajo}` : null,
    `💰 *Precio:* ${precioFormatted}`,
    `💳 *Esquema:* ${esquemaPago}`,
    ``,
    `⏰ ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`,
  ].filter(Boolean).join('\n');

  // Enviar a todos los números de notificación (fire-and-forget)
  const results = await Promise.allSettled(
    NOTIFICATION_NUMBERS.map(num => sendWhatsAppText(num, message))
  );

  const sent = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
  console.log(`📲 Notificación de cotización enviada a ${sent}/${NOTIFICATION_NUMBERS.length} números`);

  return { sent, total: NOTIFICATION_NUMBERS.length };
};

/**
 * Notificar que llegó un nuevo cliente por WhatsApp
 * Se envía a los números de seguimiento (no a Sofia)
 * @param {object} clientData - Datos básicos del cliente
 */
const NEW_CLIENT_NOTIFY_NUMBERS = [
  '525583352096',
  '525512478395',
];

export const notifyNewClient = async (clientData) => {
  const {
    clientName = 'Cliente',
    clientPhone = '',
    tipoServicio = '',
    source = 'WhatsApp',
  } = clientData;

  const message = [
    `🆕 *Nuevo Cliente — ${source}*`,
    ``,
    `👤 *Nombre:* ${clientName}`,
    clientPhone ? `📱 *Teléfono:* ${clientPhone}` : null,
    tipoServicio ? `📝 *Servicio:* ${tipoServicio}` : null,
    ``,
    `📞 Sofia ya recabó sus datos.`,
    `Contactar al 5561757123 para seguimiento.`,
    ``,
    `⏰ ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`,
  ].filter(Boolean).join('\n');

  const results = await Promise.allSettled(
    NEW_CLIENT_NOTIFY_NUMBERS.map(num => sendWhatsAppText(num, message))
  );

  const sent = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
  console.log(`📲 Notificación de nuevo cliente enviada a ${sent}/${NEW_CLIENT_NOTIFY_NUMBERS.length} números`);

  return { sent, total: NEW_CLIENT_NOTIFY_NUMBERS.length };
};

export default { sendWhatsAppText, notifyQuoteSent, notifyNewClient };
