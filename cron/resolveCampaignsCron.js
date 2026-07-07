/**
 * Resolve Campaigns Cron
 *
 * Los leads que vienen de anuncios click-to-WhatsApp traen solo `ad_id` (el referral
 * de Meta no incluye el nombre de campaña). Este cron resuelve `ad_id` -> nombre de
 * campaña/adset/anuncio vía Graph API (cacheado por corrida) y actualiza Supabase,
 * para que el panel muestre la campaña por nombre en cada lead.
 *
 * Corre cada 30 min. Seguro: solo lee de Meta y actualiza columnas de atribución.
 * Nunca lanza (todo en try/catch) para no afectar el resto del server.
 */
import cron from 'node-cron';

const GRAPH = 'https://graph.facebook.com/v21.0';
const SUPA = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';

function supaHeaders() {
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
}

async function resolveAd(adId, token, cache) {
  if (cache.has(adId)) return cache.get(adId);
  let info = { ad_name: '', ad_adset_name: '', ad_campaign_name: '' };
  try {
    const r = await fetch(`${GRAPH}/${adId}?fields=name,adset{name},campaign{name}&access_token=${token}`);
    const j = await r.json();
    if (!j.error) {
      info = {
        ad_name: j.name || '',
        ad_adset_name: j.adset?.name || '',
        ad_campaign_name: j.campaign?.name || '',
      };
    } else {
      console.warn(`[ResolveCampaigns] ad ${adId}: ${j.error.message}`);
    }
  } catch (e) {
    console.warn(`[ResolveCampaigns] ad ${adId}: ${e.message}`);
  }
  cache.set(adId, info);
  return info;
}

async function runResolveCampaigns() {
  const token = process.env.META_ACCESS_TOKEN;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!token || !KEY) return { skipped: 'no_config' };

  try {
    // Leads con ad_id pero sin nombre de campaña resuelto
    const url = `${SUPA}/rest/v1/leads?select=wa_id,ad_id,ad_campaign_name&ad_id=neq.&or=(ad_campaign_name.is.null,ad_campaign_name.eq.)&limit=200`;
    const res = await fetch(url, { headers: supaHeaders() });
    const leads = await res.json();
    if (!Array.isArray(leads) || leads.length === 0) return { updated: 0 };

    const cache = new Map();
    let updated = 0;
    for (const lead of leads) {
      const info = await resolveAd(lead.ad_id, token, cache);
      if (!info.ad_campaign_name && !info.ad_name) continue;
      const patch = await fetch(`${SUPA}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
        method: 'PATCH',
        headers: { ...supaHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify(info),
      });
      if (patch.ok) updated++;
    }
    console.log(`[ResolveCampaigns] ${updated}/${leads.length} leads actualizados con nombre de campaña.`);
    return { updated, scanned: leads.length };
  } catch (e) {
    console.warn('[ResolveCampaigns] error:', e.message);
    return { error: e.message };
  }
}

export function startResolveCampaignsCron() {
  // Cada 30 minutos
  cron.schedule('*/30 * * * *', runResolveCampaigns);
  console.log('[ResolveCampaigns] Cron iniciado (cada 30 min: ad_id -> nombre de campaña)');
}

export { runResolveCampaigns };
