/**
 * WhatsApp Controller — Panel de administración
 * Conecta con Supabase (leads) y WhatsApp Business API
 */

import asyncHandler from 'express-async-handler';

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
export const sendMessage = asyncHandler(async (req, res) => {
  const { wa_id, mensaje } = req.body;

  if (!wa_id || !mensaje) {
    res.status(400);
    throw new Error('wa_id y mensaje son requeridos');
  }

  // 1. Enviar mensaje por WhatsApp Business API
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const waResponse = await fetch(waUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: wa_id.replace(/\D/g, ''),
      type: 'text',
      text: { body: mensaje },
    }),
  });

  if (!waResponse.ok) {
    const errorData = await waResponse.text();
    console.error('WhatsApp API error:', errorData);
    res.status(waResponse.status);
    throw new Error(`Error al enviar WhatsApp: ${errorData}`);
  }

  const waResult = await waResponse.json();

  // 2. Obtener historial actual del lead
  const getUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=historial_chat&limit=1`;
  const getResponse = await fetch(getUrl, { headers: supabaseHeaders() });
  let historial = [];
  if (getResponse.ok) {
    const leadData = await getResponse.json();
    if (leadData[0]?.historial_chat) {
      const raw = leadData[0].historial_chat;
      if (Array.isArray(raw)) {
        historial = raw;
      } else if (typeof raw === 'string' && raw.trim()) {
        try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
      }
    }
  }

  // 3. Agregar mensaje al historial
  historial.push({
    role: 'assistant',
    content: `[HUMANO] ${mensaje}`,
  });

  // 4. Guardar historial actualizado en Supabase
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      historial_chat: JSON.stringify(historial),
      updated_at: new Date().toISOString(),
    }),
  });

  res.json({
    success: true,
    message_id: waResult.messages?.[0]?.id || null,
  });
});
