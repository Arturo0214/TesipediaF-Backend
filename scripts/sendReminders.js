#!/usr/bin/env node
/**
 * Script de recordatorio masivo — Sofia envia mensajes personalizados
 * a todos los leads de las ultimas 24h segun su estado.
 *
 * Ejecutar: node scripts/sendReminders.js
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WA_PHONE_ID = process.env.WA_PHONE_ID || '978427788691495';
const WA_TOKEN = process.env.WA_TOKEN;

const ADMIN_IDS = ['5215583352096', '525561757123', '525512478395', '5215541004180', '5215561757123'];

if (!SUPABASE_SERVICE_KEY || !WA_TOKEN) {
  console.error('Faltan variables de entorno: SUPABASE_SERVICE_KEY y/o WA_TOKEN');
  process.exit(1);
}

// Mensajes de Sofia personalizados por estado
function sofiaMessage(lead) {
  const nombre = (lead.nombre || '').split(' ')[0];

  if (lead.estado_sofia === 'bienvenida') {
    return nombre
      ? `Hola ${nombre}, soy Sofia de Tesipedia. Vi que nos contactaste pero no alcanzamos a platicar. Me encantaria ayudarte con tu tesis o proyecto academico. Cuentame, en que tema necesitas apoyo?`
      : `Hola! Soy Sofia de Tesipedia. Vi que nos contactaste pero no pudimos conversar. Me encantaria ayudarte con tu tesis. Cuentame, que necesitas?`;
  }

  if (lead.estado_sofia === 'calificando') {
    return nombre
      ? `Hola ${nombre}, soy Sofia de Tesipedia. Estabamos platicando sobre tu proyecto de tesis. Para poder darte una cotizacion necesito algunos datos mas. Podemos continuar?`
      : `Hola! Soy Sofia de Tesipedia. Nos quedamos a medias con los datos de tu proyecto. Para cotizarte necesito un poco mas de info. Seguimos?`;
  }

  // cotizando
  return nombre
    ? `Hola ${nombre}, soy Sofia de Tesipedia. Ya casi tenemos lista tu cotizacion! Solo necesito confirmar unos detalles para enviartela. Podemos continuar?`
    : `Hola! Soy Sofia de Tesipedia. Tu cotizacion esta casi lista, solo necesito confirmar unos detalles. Seguimos?`;
}

async function main() {
  console.log('Consultando leads de las ultimas 24h...\n');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=gte.${since}&estado_sofia=in.(bienvenida,calificando,cotizando)&modo_humano=eq.false&select=wa_id,nombre,estado_sofia,updated_at,historial_chat`;

  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });

  if (!resp.ok) {
    console.error('Error al consultar Supabase:', resp.status, await resp.text());
    process.exit(1);
  }

  const allLeads = await resp.json();
  const leads = allLeads.filter(l => !ADMIN_IDS.includes(l.wa_id));

  console.log(`Encontrados ${leads.length} leads (${allLeads.length - leads.length} admins excluidos)`);
  const byState = leads.reduce((a, l) => { a[l.estado_sofia] = (a[l.estado_sofia] || 0) + 1; return a; }, {});
  console.log('Por estado:', JSON.stringify(byState), '\n');

  if (leads.length === 0) {
    console.log('No hay leads para enviar recordatorio.');
    return;
  }

  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  let sent = 0, failed = 0;

  for (const lead of leads) {
    const cleanNumber = lead.wa_id.replace(/\D/g, '');
    const msg = sofiaMessage(lead);

    // Mensaje de texto normal (como Sofia)
    const payload = {
      messaging_product: 'whatsapp',
      to: cleanNumber,
      type: 'text',
      text: { body: msg },
    };

    try {
      const waResp = await fetch(waUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const waData = await waResp.json();

      if (waData.messages) {
        sent++;
        console.log(`  OK: ${lead.nombre || lead.wa_id} (${lead.estado_sofia})`);

        // Actualizar historial del lead en Supabase
        let historial = [];
        const raw = lead.historial_chat;
        if (Array.isArray(raw)) historial = raw;
        else if (typeof raw === 'string' && raw.trim()) {
          try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
        }

        historial.push({
          role: 'assistant',
          content: msg,
          timestamp: new Date().toISOString(),
          isReengagement: true,
        });

        await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            historial_chat: JSON.stringify(historial),
            updated_at: new Date().toISOString(),
          }),
        });
      } else {
        failed++;
        const errMsg = waData.error?.message || JSON.stringify(waData).substring(0, 150);
        console.log(`  FAIL: ${lead.nombre || lead.wa_id} (${lead.estado_sofia}) — ${errMsg}`);
      }
    } catch (e) {
      failed++;
      console.log(`  ERROR: ${lead.nombre || lead.wa_id} — ${e.message}`);
    }

    // Pausa entre mensajes para no saturar la API
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nResultado: ${sent} enviados, ${failed} fallidos de ${leads.length} leads`);
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
