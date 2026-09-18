// Vincula una GeneratedQuote con su lead de Supabase por ID (no por teléfono).
// - quote.leadId  = leads.id (uuid)
// - quote.waId    = leads.wa_id
// - leads.cotizacion_id = quote.publicId (cotización más reciente del lead)
// Resuelve el lead por wa_id exacto (si viene de Sofia) o por los últimos 10 dígitos del teléfono.
// Nunca lanza: si algo falla, deja la cotización sin vincular y sigue.

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const hdr = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
const last10 = (x) => String(x || '').replace(/\D/g, '').slice(-10);

export async function linkGeneratedQuoteToLead(quote, opts = {}) {
  try {
    if (!SUPABASE_URL || !KEY || !quote) return null;
    const waHint = String(opts.waId || quote.waId || '').replace(/\D/g, '');
    const k = last10(quote.clientPhone || waHint);
    if ((!k || k.length < 10) && !(waHint && waHint.length >= 10)) return null;

    let lead = null;
    // 1) match exacto por wa_id (cuando Sofia/n8n manda el waId)
    if (waHint && waHint.length >= 10) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${encodeURIComponent(waHint)}&select=id,wa_id&limit=1`, { headers: hdr() });
      const a = await r.json();
      if (Array.isArray(a) && a[0]) lead = a[0];
    }
    // 2) fallback: por sufijo de teléfono (últimos 10 dígitos), el más reciente
    if (!lead && k && k.length >= 10) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=like.*${k}&select=id,wa_id,updated_at&order=updated_at.desc&limit=1`, { headers: hdr() });
      const a = await r.json();
      if (Array.isArray(a) && a[0]) lead = a[0];
    }
    if (!lead) return null;

    // Grabar en el quote (Mongo)
    quote.leadId = lead.id;
    quote.waId = lead.wa_id;
    await quote.save();

    // Grabar en el lead (Supabase): la cotización más reciente
    await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${encodeURIComponent(lead.wa_id)}`, {
      method: 'PATCH',
      headers: { ...hdr(), Prefer: 'return=minimal' },
      body: JSON.stringify({ cotizacion_id: quote.publicId }),
    });

    return { leadId: lead.id, waId: lead.wa_id };
  } catch (e) {
    console.error('[linkQuoteLead] error:', e.message);
    return null;
  }
}

export default linkGeneratedQuoteToLead;
