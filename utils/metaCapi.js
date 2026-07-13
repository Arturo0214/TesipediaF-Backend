// utils/metaCapi.js
// Conversions API (CAPI) para anuncios Click-to-WhatsApp (CTWA).
//
// Atribución CTWA: cuando alguien da clic en un anuncio "enviar mensaje por WhatsApp",
// el 1er mensaje entrante trae un `referral.ctwa_clid` (lo captura n8n y lo guarda en
// leads.ctwa_clid). Al confirmar un pago (o calificar un lead) reenviamos un evento a
// Meta con ese ctwa_clid para que Meta atribuya la conversión al anuncio exacto.
//
// Campos clave para CTWA (según spec de Meta):
//   action_source: 'business_messaging'  +  messaging_channel: 'whatsapp'
//   user_data.ctwa_clid  (obligatorio para atribuir)
//   user_data.whatsapp_business_account_id  (recomendado; opcional vía env META_WABA_ID)
//
// Nunca lanza: si algo falla, regresa { ok:false, ... } y solo hace console.warn.
// Así jamás afecta el flujo de pago que lo invoca (llamar fire-and-forget).

import crypto from 'crypto';

const GRAPH = 'https://graph.facebook.com/v21.0';
const PIXEL_ID = process.env.META_PIXEL_ID; // Meta Pixel de CTWA (configurado en Railway)
const TOKEN = process.env.META_CAPI_TOKEN || process.env.META_ACCESS_TOKEN;
const WABA_ID = process.env.META_WABA_ID || '';

const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

// Normaliza un teléfono a wa_id (mismo criterio que el nodo Parse de n8n): dígitos + prefijo 521 para MX.
export function normalizeWaId(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('52') && !d.startsWith('521')) d = '521' + d.slice(2);
  else if (!d.startsWith('521') && d.length >= 10) d = '521' + d.slice(-10);
  return d;
}

/**
 * Envía un evento CAPI CTWA a Meta.
 * @param {{eventName:string, ctwaClid:string, phone?:string, value?:number, currency?:string, eventId?:string, testEventCode?:string}} p
 */
export async function sendCtwaEvent({ eventName, ctwaClid, phone, value, currency = 'MXN', eventId, testEventCode } = {}) {
  if (!TOKEN) return { ok: false, skipped: 'no_token' };
  if (!PIXEL_ID) return { ok: false, skipped: 'no_pixel_id' };
  if (!eventName) return { ok: false, skipped: 'no_event_name' };
  if (!ctwaClid) return { ok: false, skipped: 'no_ctwa_clid' };

  const user_data = { ctwa_clid: ctwaClid };
  if (WABA_ID) user_data.whatsapp_business_account_id = WABA_ID;
  if (phone) {
    const wa = normalizeWaId(phone);
    if (wa) user_data.ph = [sha256(wa)];
  }

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    ...(eventId ? { event_id: eventId } : {}),
    user_data,
    ...(value != null ? { custom_data: { currency, value: Number(value) } } : {}),
  };

  const body = { data: [event], ...(testEventCode ? { test_event_code: testEventCode } : {}) };

  try {
    const r = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.error) {
      console.warn('[CAPI] Meta error:', j.error.message, '(code', j.error.code + ')');
      return { ok: false, error: j.error };
    }
    console.log(`[CAPI] ${eventName} enviado (ctwa_clid=${String(ctwaClid).slice(0, 10)}…) events_received=${j.events_received}`);
    return { ok: true, result: j };
  } catch (e) {
    console.warn('[CAPI] fetch fail:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Busca el ctwa_clid del lead en Supabase (por teléfono) y, si existe, dispara el evento.
 * Es el punto de entrada práctico desde los controllers de pago.
 * Fire-and-forget: `fireCtwaEventByPhone({...}).catch(()=>{})`.
 */
export async function fireCtwaEventByPhone({ eventName, phone, value, currency = 'MXN', eventId } = {}) {
  try {
    const SUPA = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPA || !KEY || !phone) return { ok: false, skipped: 'no_config' };
    const wa = normalizeWaId(phone);
    if (!wa) return { ok: false, skipped: 'no_phone' };

    const r = await fetch(`${SUPA}/rest/v1/leads?wa_id=eq.${wa}&select=ctwa_clid,ctwa_clid_at&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const rows = await r.json();
    const clid = Array.isArray(rows) ? rows[0]?.ctwa_clid : null;
    if (!clid) return { ok: false, skipped: 'lead_sin_ctwa_clid' };

    return await sendCtwaEvent({ eventName, ctwaClid: clid, phone, value, currency, eventId });
  } catch (e) {
    console.warn('[CAPI] fireCtwaEventByPhone fail:', e.message);
    return { ok: false, error: e.message };
  }
}
