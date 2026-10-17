import GeneratedQuote from '../models/GeneratedQuote.js';

/**
 * Ventas PERSONALES de Arturo (flag `privado` en GeneratedQuote/Payment).
 * Solo las ven el superadmin y Paula; para cualquier otro admin se filtran
 * de Revenue, cotizaciones, pagos, seguimiento y leads de WhatsApp —
 * listas Y totales, para que no se noten por diferencia de sumas.
 */
export const puedeVerVentasPrivadas = (user) =>
  user?.role === 'superadmin' || /paula/i.test(user?.name || '');

// Fragmento de query/$match: {} para ojos autorizados, excluye privadas para el resto
export const filtroPrivado = (user) =>
  puedeVerVentasPrivadas(user) ? {} : { privado: { $ne: true } };

/* ── Leads de WhatsApp ligados a cotizaciones privadas ──
 * El vínculo vive en 3 lugares: leads.cotizacion_id = quote.publicId,
 * quote.waId = leads.wa_id, y el teléfono del cliente. Cache 60s. */
const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
let _cache = { at: 0, publicIds: new Set(), waIds: new Set(), phones: new Set() };

async function idsPrivados() {
  if (Date.now() - _cache.at < 60_000) return _cache;
  const quotes = await GeneratedQuote.find({ privado: true })
    .select('publicId waId clientPhone').lean();
  _cache = {
    at: Date.now(),
    publicIds: new Set(quotes.map((q) => String(q.publicId || '')).filter(Boolean)),
    waIds: new Set(quotes.map((q) => String(q.waId || '')).filter(Boolean)),
    phones: new Set(quotes.map((q) => last10(q.clientPhone)).filter((p) => p.length === 10)),
  };
  return _cache;
}

// Quita de un array de leads (filas de Supabase) los ligados a cotizaciones privadas.
// Para Arturo/Paula devuelve el array intacto.
export async function filtrarLeadsPrivados(user, leads) {
  if (puedeVerVentasPrivadas(user) || !Array.isArray(leads) || !leads.length) return leads;
  try {
    const { publicIds, waIds, phones } = await idsPrivados();
    if (!publicIds.size && !waIds.size && !phones.size) return leads;
    return leads.filter((l) =>
      !publicIds.has(String(l?.cotizacion_id || ''))
      && !waIds.has(String(l?.wa_id || ''))
      && !phones.has(last10(l?.wa_id)));
  } catch {
    return leads; // nunca romper el panel por el filtro
  }
}

export default puedeVerVentasPrivadas;
