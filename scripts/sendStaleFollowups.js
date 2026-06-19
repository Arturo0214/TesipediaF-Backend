/**
 * Envío puntual de seguimiento a leads con +24h sin contacto (ventana 24h expirada).
 *
 * Identifica leads en embudo ACTIVO (no pagados, no descartados, no bloqueados,
 * no en modo humano) cuyo último contacto fue hace más de MIN_HOURS, y les envía
 * la plantilla aprobada `seguimiento_tesipedia` — la única forma permitida por
 * WhatsApp fuera de la ventana de 24h.
 *
 * Salvaguardas:
 *  - Salta si ya hay 2+ recordatorios/plantillas consecutivos sin respuesta.
 *  - Salta si ya recibió una plantilla en las últimas RECENT_TEMPLATE_HOURS
 *    (evita doble-envío justo después del auto-reminder recién desplegado).
 *
 * Uso:
 *   node --env-file=.env scripts/sendStaleFollowups.js            # DRY-RUN (no envía)
 *   node --env-file=.env scripts/sendStaleFollowups.js --send     # ENVÍA de verdad
 *   ... --max=50                                                  # tope de envíos
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const WA_TOKEN = process.env.WA_TOKEN;

const WA_TEMPLATE_NAME = 'seguimiento_tesipedia';
const WA_TEMPLATE_LANG = 'es_MX';
const HOURS_24 = 24 * 60 * 60 * 1000;

const ADMIN_IDS = ['5215583352096', '525561757123', '525512478395', '5215541004180', '5215561757123'];
const ACTIVE_STATES = ['bienvenida', 'calificando', 'cotizando', 'cotizacion_lista', 'cotizacion_enviada'];

// ── flags ──
const SEND = process.argv.includes('--send');
const MIN_HOURS = Number((process.argv.find(a => a.startsWith('--minHours=')) || '').split('=')[1]) || 24;
const MAX = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1]) || 300;
const RECENT_TEMPLATE_HOURS = 12;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
}

function parseHist(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw.replace(/^=/, '')); } catch { return []; }
  }
  return [];
}

// Misma lógica que isWindowExpired del controller
function isWindowExpired(historial, updatedAt) {
  const fallback = () => (updatedAt ? (Date.now() - new Date(updatedAt).getTime()) > HOURS_24 : true);
  if (!Array.isArray(historial) || historial.length === 0) return fallback();
  const lastUserMsg = [...historial].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) return fallback();
  if (lastUserMsg.timestamp) return (Date.now() - new Date(lastUserMsg.timestamp).getTime()) > HOURS_24;
  return fallback();
}

function hoursSinceLastTemplate(historial) {
  const last = [...historial].reverse().find(m => m.isTemplate || m.isReengagement || m.isRevival || m.isCalificacionFollowUp);
  if (!last || !last.timestamp) return Infinity;
  return (Date.now() - new Date(last.timestamp).getTime()) / 3600000;
}

function consecutiveReminders(historial) {
  let c = 0;
  for (let i = historial.length - 1; i >= 0; i--) {
    const m = historial[i];
    if (m.role === 'user') break;
    if (m.isTemplate || m.isReengagement || m.isRevival || m.isCalificacionFollowUp) c++;
  }
  return c;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !WA_PHONE_ID || !WA_TOKEN) {
    console.error('❌ Faltan variables de entorno. Corre con: node --env-file=.env scripts/sendStaleFollowups.js');
    process.exit(1);
  }

  const since = new Date(Date.now() - MIN_HOURS * 3600 * 1000).toISOString();
  const statesCsv = ACTIVE_STATES.join(',');
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${since}` +
    `&estado_sofia=in.(${statesCsv})` +
    `&bloqueado=neq.true&modo_humano=neq.true&auto_paused=neq.true` +
    `&select=wa_id,nombre,estado_sofia,updated_at,historial_chat&order=updated_at.asc&limit=1000`;

  const resp = await fetch(url, { headers: supabaseHeaders() });
  if (!resp.ok) {
    console.error('❌ Supabase error', resp.status, await resp.text());
    process.exit(1);
  }
  const all = (await resp.json()).filter(l => !ADMIN_IDS.includes(l.wa_id));

  console.log(`\n${SEND ? '🚀 MODO ENVÍO' : '🔍 DRY-RUN (no se envía nada)'} — leads en embudo activo con > ${MIN_HOURS}h sin contacto`);
  console.log(`   Candidatos crudos (query): ${all.length}\n`);

  const toSend = [];
  const skips = { ventanaAbierta: 0, maxRecordatorios: 0, plantillaReciente: 0 };
  const porEstado = {};

  for (const lead of all) {
    const hist = parseHist(lead.historial_chat);
    if (!isWindowExpired(hist, lead.updated_at)) { skips.ventanaAbierta++; continue; }
    if (consecutiveReminders(hist) >= 2) { skips.maxRecordatorios++; continue; }
    if (hoursSinceLastTemplate(hist) < RECENT_TEMPLATE_HOURS) { skips.plantillaReciente++; continue; }
    toSend.push(lead);
    porEstado[lead.estado_sofia] = (porEstado[lead.estado_sofia] || 0) + 1;
  }

  const finalList = toSend.slice(0, MAX);

  console.log('   Desglose de descartados:');
  console.log(`     · Ventana aún abierta (<24h real):      ${skips.ventanaAbierta}`);
  console.log(`     · Ya tienen 2+ recordatorios sin resp.: ${skips.maxRecordatorios}`);
  console.log(`     · Plantilla enviada hace <${RECENT_TEMPLATE_HOURS}h:           ${skips.plantillaReciente}`);
  console.log(`\n   ✅ ELEGIBLES para plantilla: ${toSend.length}` + (toSend.length > MAX ? ` (se procesarán ${MAX} por --max)` : ''));
  console.log('   Por estado:', JSON.stringify(porEstado));

  if (!SEND) {
    console.log('\n   Muestra (primeros 10):');
    finalList.slice(0, 10).forEach(l => {
      const h = Math.round((Date.now() - new Date(l.updated_at).getTime()) / 3600000);
      console.log(`     - ${l.nombre || l.wa_id} | ${l.estado_sofia} | ${h}h sin contacto`);
    });
    console.log('\n   ▶ Para enviar de verdad: agrega --send\n');
    return;
  }

  // ── ENVÍO REAL ──
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  let sent = 0, failed = 0;
  const fails = [];

  for (const lead of finalList) {
    const firstName = (lead.nombre || '').split(' ')[0] || 'cliente';
    const cleanNumber = lead.wa_id.replace(/\D/g, '');
    try {
      const r = await fetch(waUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: cleanNumber, type: 'template',
          template: { name: WA_TEMPLATE_NAME, language: { code: WA_TEMPLATE_LANG },
            components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }] },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!data.messages) {
        failed++; fails.push(`${lead.wa_id}: ${data.error?.message || 'sin messages'}`); continue;
      }
      sent++;
      const hist = parseHist(lead.historial_chat);
      hist.push({
        role: 'assistant',
        content: `[TEMPLATE:seguimiento] Hola ${firstName}, somos el equipo de Tesipedia. Queremos darte seguimiento sobre tu proyecto academico. Si sigues interesado o tienes alguna duda, respondenos a este mensaje y con gusto te ayudamos.`,
        timestamp: new Date().toISOString(), isTemplate: true, isReengagement: true,
      });
      await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
        method: 'PATCH', headers: supabaseHeaders(),
        body: JSON.stringify({ historial_chat: JSON.stringify(hist), updated_at: new Date().toISOString() }),
      });
    } catch (e) {
      failed++; fails.push(`${lead.wa_id}: ${e.message}`);
    }
  }

  console.log(`\n   📤 Enviados: ${sent} | ❌ Fallidos: ${failed}`);
  if (fails.length) { console.log('   Fallos:'); fails.slice(0, 20).forEach(f => console.log('     · ' + f)); }
}

main().catch(e => { console.error(e); process.exit(1); });
