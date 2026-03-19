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
 * POST /api/v1/whatsapp/send
 * Enviar mensaje por WhatsApp y guardar en historial
 */
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

  // 1. Enviar mensaje por WhatsApp Business API
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    to: wa_id.replace(/\D/g, ''),
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

  if (!waResponse.ok) {
    const errorData = await waResponse.text();
    console.error('WhatsApp API error:', errorData);
    res.status(waResponse.status);
    throw new Error(`Error al enviar WhatsApp: ${errorData}`);
  }

  const waResult = await waResponse.json();

  // 2. Obtener historial actual del lead (o crear uno si no existe)
  const getUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=historial_chat,wa_id&limit=1`;
  const getResponse = await fetch(getUrl, { headers: supabaseHeaders() });
  let historial = [];
  let leadExists = false;
  if (getResponse.ok) {
    const leadData = await getResponse.json();
    if (leadData.length > 0) {
      leadExists = true;
      if (leadData[0]?.historial_chat) {
        const raw = leadData[0].historial_chat;
        if (Array.isArray(raw)) {
          historial = raw;
        } else if (typeof raw === 'string' && raw.trim()) {
          try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
        }
      }
    }
  }

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

  // 3. Agregar mensaje al historial (con nombre del admin)
  const adminName = req.user?.name || 'Admin';
  const newMsg = {
    role: 'assistant',
    content: mensaje ? `[HUMANO:${adminName}] ${mensaje}` : `[HUMANO:${adminName}] (Archivo)`,
    timestamp: new Date().toISOString(),
  };

  if (mediaUrl) {
    newMsg.mediaUrl = mediaUrl;
    newMsg.mimetype = mimetype;
    newMsg.filename = filename;
  }

  historial.push(newMsg);

  // 4. Guardar historial actualizado en Supabase + quién atendió
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
  });
});
