/**
 * resolveLeadCampaigns.js
 *
 * El referral CTWA solo trae `ad_id` (no el nombre de campaña/adset/anuncio).
 * Este script busca leads con `ad_id` pero sin `ad_campaign_name`, resuelve los
 * nombres vía Graph API (una llamada por ad_id único, cacheada) y hace PATCH a Supabase.
 *
 * Uso: node scripts/resolveLeadCampaigns.js
 * Ideal para correr en cron cada pocas horas (los leads de anuncio son pocos/día).
 * Seguro: solo lee de Meta y actualiza columnas de atribución; no toca nada más.
 */
import 'dotenv/config';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_ACCESS_TOKEN;
const SUPA = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const BATCH = Number(process.env.RESOLVE_BATCH || 200);

const supaHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function resolveAd(adId, cache) {
  if (cache.has(adId)) return cache.get(adId);
  let info = { ad_name: '', ad_adset_name: '', ad_campaign_name: '' };
  try {
    const r = await fetch(`${GRAPH}/${adId}?fields=name,adset{name},campaign{name}&access_token=${TOKEN}`);
    const j = await r.json();
    if (!j.error) {
      info = {
        ad_name: j.name || '',
        ad_adset_name: j.adset?.name || '',
        ad_campaign_name: j.campaign?.name || '',
      };
    } else {
      console.warn(`  ⚠️ ad ${adId}: ${j.error.message}`);
    }
  } catch (e) {
    console.warn(`  ⚠️ ad ${adId}: ${e.message}`);
  }
  cache.set(adId, info);
  return info;
}

async function run() {
  if (!TOKEN || !KEY) { console.error('Falta META_ACCESS_TOKEN o SUPABASE_SERVICE_KEY'); process.exit(1); }

  // Leads con ad_id pero sin nombre de campaña resuelto
  const url = `${SUPA}/rest/v1/leads?select=wa_id,ad_id,ad_campaign_name&ad_id=neq.&or=(ad_campaign_name.is.null,ad_campaign_name.eq.)&limit=${BATCH}`;
  const res = await fetch(url, { headers: supaHeaders });
  const leads = await res.json();
  if (!Array.isArray(leads) || leads.length === 0) { console.log('✅ Nada por resolver.'); return; }

  console.log(`🔄 Resolviendo campaña para ${leads.length} lead(s)...`);
  const cache = new Map();
  let updated = 0;

  for (const lead of leads) {
    const info = await resolveAd(lead.ad_id, cache);
    if (!info.ad_campaign_name && !info.ad_name) continue;
    const patch = await fetch(`${SUPA}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
      method: 'PATCH',
      headers: { ...supaHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(info),
    });
    if (patch.ok) { updated++; console.log(`  ✓ ${lead.wa_id} → ${info.ad_campaign_name || info.ad_name}`); }
    else console.warn(`  ✗ ${lead.wa_id}: HTTP ${patch.status}`);
  }
  console.log(`✅ Listo. ${updated}/${leads.length} actualizados. Ads únicos consultados: ${cache.size}.`);
}

run().catch(e => { console.error(e); process.exit(1); });
