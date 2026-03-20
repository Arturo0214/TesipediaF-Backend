/**
 * WhatsApp Controller — Panel de administración
 * Conecta con Supabase (leads) y WhatsApp Business API
 */

import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const WA_PHONE_ID = process.env.WA_PHONE_ID || '978427788691495';
const WA_TOKEN = process.env.WA_TOKEN || '';

// Plantilla aprobada para enviar fuera de la ventana de 24h
const WA_TEMPLATE_NAME = 'seguimiento_tesipedia';
const WA_TEMPLATE_LANG = 'es_MX';
const HOURS_24 = 24 * 60 * 60 * 1000;

/**
 * Helper: determinar si la ventana de 24h expiró
 * Busca el último mensaje del USUARIO (role === 'user') en el historial.
 * Usa updated_at del lead como fallback cuando los mensajes no tienen timestamp
 * (ej. conversaciones que llegan por n8n/Sofía).
 */
function isWindowExpired(historial, updatedAt) {
  if (!Array.isArray(historial) || historial.length === 0) {
    // Sin historial: usar updated_at como fallback
    if (updatedAt) {
      const updTime = new Date(updatedAt).getTime();
      return (Date.now() - updTime) > HOURS_24;
    }
    return true;
  }
  // Buscar el último mensaje del usuario (no del bot/admin)
  const lastUserMsg = [...historial]
    .reverse()
    .find(m => m.role === 'user');
  if (!lastUserMsg) {
    // No hay mensajes de usuario: usar updated_at como fallback
    if (updatedAt) {
      const updTime = new Date(updatedAt).getTime();
      return (Date.now() - updTime) > HOURS_24;
    }
    return true;
  }
  // Si el mensaje tiene timestamp, usarlo; si no, usar updated_at como fallback
  if (lastUserMsg.timestamp) {
    const lastTime = new Date(lastUserMsg.timestamp).getTime();
    return (Date.now() - lastTime) > HOURS_24;
  }
  // Sin timestamp en el mensaje: usar updated_at del lead
  if (updatedAt) {
    const updTime = new Date(updatedAt).getTime();
    return (Date.now() - updTime) > HOURS_24;
  }
  return true;
}

// Helper: headers para Supabase
const supabaseHeaders = () => ({
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
});

/**
 * GET /api/v1/whatsapp/leads
 * Obtener todos los leads con conversaciones
 */
export const getLeads = asyncHandler(async (req, res) => {
  const url = `${SUPABASE_URL}/rest/v1/leads?select=*&order=updated_at.desc`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    const errorText = await response.text();
    res.status(response.status);
    throw new Error(`Error de Supabase: ${errorText}`);
  }
  const data = await response.json();
  res.json(data);
});

/**
 * GET /api/v1/whatsapp/leads/:waId
 * Obtener un lead por wa_id
 */
export const getLeadByWaId = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const url = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    res.status(response.status);
    throw new Error('Error al obtener lead');
  }
  const data = await response.json();
  res.json(data[0] || null);
});

/**
 * PATCH /api/v1/whatsapp/leads/:waId/modo-humano
 * Activar/desactivar modo humano
 */
export const toggleModoHumano = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { modo_humano } = req.body;

  const url = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      modo_humano: Boolean(modo_humano),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    res.status(response.status);
    throw new Error('Error al cambiar modo humano');
  }
  const data = await response.json();
  res.json({ success: true, data });
});

/**
 * GET /api/v1/whatsapp/leads-status
 * Devuelve un mapa de leads con estado_sofia para cruzar con HubSpot
 */
export const getLeadsStatus = asyncHandler(async (req, res) => {
  const url = `${SUPABASE_URL}/rest/v1/leads?select=wa_id,nombre,estado_sofia,updated_at`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    const errorText = await response.text();
    res.status(response.status);
    throw new Error(`Error de Supabase: ${errorText}`);
  }
  const data = await response.json();
  res.json(data);
});

/**
 * PATCH /api/v1/whatsapp/leads/:waId/estado
 * Actualizar el estado_sofia de un lead
 */
export const updateLeadEstado = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { estado_sofia } = req.body;
  if (!waId || !estado_sofia) {
    res.status(400);
    throw new Error('wa_id y estado_sofia son requeridos');
  }
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}`;
  const response = await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      estado_sofia,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    res.status(response.status);
    throw new Error(`Error actualizando estado: ${err}`);
  }
  res.json({ success: true, estado_sofia });
});

/**
 * GET /api/v1/whatsapp/leads/:waId/window-status
 * Verificar si la ventana de 24h está activa o expirada
 */
export const getWindowStatus = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const url = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}&select=historial_chat,nombre,updated_at&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    res.status(response.status);
    throw new Error('Error al obtener lead');
  }
  const data = await response.json();
  if (!data.length) {
    return res.json({ expired: true, lastUserMessage: null });
  }
  const updatedAt = data[0]?.updated_at || null;
  let historial = [];
  const raw = data[0]?.historial_chat;
  if (Array.isArray(raw)) {
    historial = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
  }
  const expired = isWindowExpired(historial, updatedAt);
  const lastUserMsg = [...historial].reverse().find(m => m.role === 'user');
  res.json({
    expired,
    lastUserMessage: lastUserMsg?.timestamp || updatedAt || null,
  });
});

/**
 * POST /api/v1/whatsapp/send
 * Enviar mensaje por WhatsApp y guardar en historial
 */
export const sendMessage = asyncHandler(async (req, res) => {
  const { wa_id, mensaje } = req.body;
  const file = req.file;

  if (!wa_id) {
    res.status(400);
    throw new Error('wa_id es requerido');
  }
  if (!mensaje && !file) {
    res.status(400);
    throw new Error('mensaje o archivo requerido');
  }

  // Upload file if exists
  let mediaUrl = null;
  let mediaType = null;
  let mimetype = null;
  let filename = null;

  if (file) {
    const isDoc = !!file.mimetype.match(/pdf|msword|officedocument|csv|text/i);
    const fileBuffer = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    
    const uploadOptions = {
      folder: 'whatsapp_admin_media',
      resource_type: isDoc ? 'raw' : 'auto',
    };

    // Si es un documento, subimos como 'raw' y le damos un public_id que incluya su extensión
    if (isDoc) {
      const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : 'pdf';
      uploadOptions.public_id = `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    }

    const result = await cloudinary.uploader.upload(fileBuffer, uploadOptions);
    
    mediaUrl = result.secure_url;
    mimetype = file.mimetype;
    filename = file.originalname;
    mediaType = isDoc ? 'document' : 'image';
  }

  // 1. Obtener historial para verificar ventana de 24h ANTES de enviar
  const getUrlPre = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=historial_chat,wa_id,nombre,updated_at&limit=1`;
  const getResponsePre = await fetch(getUrlPre, { headers: supabaseHeaders() });
  let historialPre = [];
  let leadExistsPre = false;
  let leadNombre = '';
  let leadUpdatedAt = null;
  if (getResponsePre.ok) {
    const leadDataPre = await getResponsePre.json();
    if (leadDataPre.length > 0) {
      leadExistsPre = true;
      leadNombre = leadDataPre[0]?.nombre || '';
      leadUpdatedAt = leadDataPre[0]?.updated_at || null;
      if (leadDataPre[0]?.historial_chat) {
        const raw = leadDataPre[0].historial_chat;
        if (Array.isArray(raw)) {
          historialPre = raw;
        } else if (typeof raw === 'string' && raw.trim()) {
          try { historialPre = JSON.parse(raw.replace(/^=/, '')); } catch { historialPre = []; }
        }
      }
    }
  }

  const windowExpired = isWindowExpired(historialPre, leadUpdatedAt);
  let templateSent = false;

  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const cleanNumber = wa_id.replace(/\D/g, '');

  // Si la ventana de 24h expiró, enviar primero la plantilla de seguimiento
  if (windowExpired) {
    const firstName = (leadNombre || '').split(' ')[0] || 'cliente';
    const templatePayload = {
      messaging_product: 'whatsapp',
      to: cleanNumber,
      type: 'template',
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: firstName }],
          },
        ],
      },
    };

    const templateResponse = await fetch(waUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templatePayload),
    });

    if (!templateResponse.ok) {
      const templateErr = await templateResponse.text();
      console.error('WhatsApp Template error:', templateErr);
      // No bloqueamos — intentaremos enviar normal de todos modos
      console.warn('Template falló, intentando enviar mensaje normal...');
    } else {
      templateSent = true;
      console.log('✅ Template de seguimiento enviado (ventana 24h expirada)');
    }
  }

  // Enviar el mensaje normal (texto/media)
  const payload = {
    messaging_product: 'whatsapp',
    to: cleanNumber,
  };

  if (mediaUrl) {
    payload.type = mediaType;
    payload[mediaType] = { link: mediaUrl };
    if (mensaje) payload[mediaType].caption = mensaje;
    if (mediaType === 'document' && filename) payload.document.filename = filename;
  } else {
    payload.type = 'text';
    payload.text = { body: mensaje };
  }

  const waResponse = await fetch(waUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let waResult;
  if (!waResponse.ok) {
    const errorData = await waResponse.text();
    console.error('WhatsApp API error:', errorData);
    // Si el template ya fue enviado, no fallar del todo
    if (templateSent) {
      console.warn('Mensaje normal falló pero template ya fue enviado');
      waResult = { messages: [] };
    } else {
      res.status(waResponse.status);
      throw new Error(`Error al enviar WhatsApp: ${errorData}`);
    }
  } else {
    waResult = await waResponse.json();
  }

  // 2. Usar historial ya obtenido arriba (evitar doble fetch)
  let historial = [...historialPre];
  let leadExists = leadExistsPre;

  // Si no existe lead para este wa_id, crearlo (permite ver conversaciones con cualquier número)
  if (!leadExists) {
    const createUrl = `${SUPABASE_URL}/rest/v1/leads`;
    await fetch(createUrl, {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        wa_id,
        nombre: `+${wa_id}`,
        estado_sofia: 'modo_humano',
        modo_humano: true,
        historial_chat: '[]',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // 3. Si se envió template, registrarlo en historial
  const adminName = req.user?.name || 'Admin';
  if (templateSent) {
    const firstName = (leadNombre || '').split(' ')[0] || 'cliente';
    historial.push({
      role: 'assistant',
      content: `[TEMPLATE:seguimiento] Hola ${firstName}, somos el equipo de Tesipedia. Queremos darte seguimiento sobre tu proyecto academico. Si sigues interesado o tienes alguna duda, respondenos a este mensaje y con gusto te ayudamos.`,
      timestamp: new Date().toISOString(),
      isTemplate: true,
    });
  }

  // 4. Agregar mensaje del admin al historial (con delivery status)
  const waMessageId = waResult.messages?.[0]?.id || null;
  const newMsg = {
    role: 'assistant',
    content: mensaje ? `[HUMANO:${adminName}] ${mensaje}` : `[HUMANO:${adminName}] (Archivo)`,
    timestamp: new Date().toISOString(),
    wa_message_id: waMessageId,
    delivery_status: waMessageId ? 'sent' : (templateSent ? 'template_only' : 'failed'),
  };

  if (mediaUrl) {
    newMsg.mediaUrl = mediaUrl;
    newMsg.mimetype = mimetype;
    newMsg.filename = filename;
  }

  historial.push(newMsg);

  // 5. Guardar historial actualizado en Supabase + quién atendió
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      historial_chat: JSON.stringify(historial),
      atendido_por: adminName.toLowerCase(),
      updated_at: new Date().toISOString(),
    }),
  });

  res.json({
    success: true,
    message_id: waMessageId,
    delivery_status: waMessageId ? 'sent' : (templateSent ? 'template_only' : 'failed'),
    templateSent,
    windowExpired,
  });
});

/**
 * POST /api/v1/whatsapp/send-template
 * Enviar SOLO la plantilla de seguimiento para revivir una conversación
 * (sin mensaje de texto adicional)
 */
export const sendTemplate = asyncHandler(async (req, res) => {
  const { wa_id } = req.body;

  if (!wa_id) {
    res.status(400);
    throw new Error('wa_id es requerido');
  }

  // 1. Obtener lead para nombre y historial
  const getUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=historial_chat,nombre&limit=1`;
  const getResponse = await fetch(getUrl, { headers: supabaseHeaders() });
  let historial = [];
  let leadNombre = '';

  if (getResponse.ok) {
    const leadData = await getResponse.json();
    if (leadData.length > 0) {
      leadNombre = leadData[0]?.nombre || '';
      const raw = leadData[0]?.historial_chat;
      if (Array.isArray(raw)) {
        historial = raw;
      } else if (typeof raw === 'string' && raw.trim()) {
        try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
      }
    }
  }

  // 2. Enviar la plantilla
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const cleanNumber = wa_id.replace(/\D/g, '');
  const firstName = (leadNombre || '').split(' ')[0] || 'cliente';

  const templatePayload = {
    messaging_product: 'whatsapp',
    to: cleanNumber,
    type: 'template',
    template: {
      name: WA_TEMPLATE_NAME,
      language: { code: WA_TEMPLATE_LANG },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: firstName }],
        },
      ],
    },
  };

  const templateResponse = await fetch(waUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(templatePayload),
  });

  if (!templateResponse.ok) {
    const templateErr = await templateResponse.text();
    console.error('WhatsApp Template error:', templateErr);
    res.status(templateResponse.status);
    throw new Error(`Error al enviar plantilla: ${templateErr}`);
  }

  const waResult = await templateResponse.json();
  console.log('✅ Template de seguimiento enviado manualmente');

  // 3. Registrar en historial
  historial.push({
    role: 'assistant',
    content: `[TEMPLATE:seguimiento] Hola ${firstName}, somos el equipo de Tesipedia. Queremos darte seguimiento sobre tu proyecto academico. Si sigues interesado o tienes alguna duda, respondenos a este mensaje y con gusto te ayudamos.`,
    timestamp: new Date().toISOString(),
    isTemplate: true,
  });

  // 4. Guardar historial actualizado
  const adminName = req.user?.name || 'Admin';
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      historial_chat: JSON.stringify(historial),
      atendido_por: adminName.toLowerCase(),
      updated_at: new Date().toISOString(),
    }),
  });

  res.json({
    success: true,
    message_id: waResult.messages?.[0]?.id || null,
    templateSent: true,
  });
});
