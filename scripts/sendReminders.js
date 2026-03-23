#!/usr/bin/env node
/**
 * Script de recordatorio masivo — Sofia envia mensajes contextuales
 * basados en el ultimo dato recabado de cada lead.
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

/**
 * Genera mensaje contextual segun el ultimo dato recabado del lead.
 * Flujo: nombre → tipo_servicio → tipo_proyecto → nivel → carrera → tema → paginas → fecha_entrega
 */
function buildSofiaContextualMessage(lead) {
  const nombre = (lead.nombre || '').split(' ')[0];
  const saludo = nombre ? `Hola ${nombre}, soy Sofia de Tesipedia.` : 'Hola! Soy Sofia de Tesipedia.';

  if (lead.estado_sofia === 'bienvenida') {
    return `${saludo} Vi que nos contactaste pero no alcanzamos a platicar. Me encantaria ayudarte con tu tesis o proyecto academico. Cuentame, que tipo de servicio necesitas? Ofrecemos redaccion completa, correccion de estilo, y asesoria.`;
  }

  if (lead.estado_sofia === 'cotizando') {
    return `${saludo} Ya tenemos todos tus datos y tu cotizacion esta casi lista! Te la envio en un momento si estas de acuerdo. Quieres que procedamos?`;
  }

  // calificando — detectar donde se quedo
  if (!lead.tipo_servicio) {
    return `${saludo} Estabamos platicando sobre tu proyecto. Para ayudarte mejor, cuentame: que tipo de servicio necesitas? Tenemos redaccion completa, correccion de estilo, o asesoria.`;
  }

  const servicioLabel = { servicio_1: 'redaccion completa', servicio_2: 'correccion de estilo', servicio_3: 'asesoria' }[lead.tipo_servicio] || lead.tipo_servicio;

  if (!lead.tipo_proyecto) {
    return `${saludo} Ya me comentaste que necesitas ${servicioLabel}. Ahora cuentame, que tipo de trabajo es? Por ejemplo: tesis, tesina, articulo cientifico, ensayo...`;
  }

  const proyectoLabel = lead.tipo_proyecto || 'tu proyecto';

  if (!lead.nivel) {
    return `${saludo} Veo que estas trabajando en ${proyectoLabel.toLowerCase() === 'otro' ? 'tu proyecto' : 'tu ' + proyectoLabel.toLowerCase()}. De que nivel academico es? Licenciatura, maestria o doctorado?`;
  }

  if (!lead.carrera) {
    return `${saludo} Ya tengo que es ${proyectoLabel.toLowerCase()} de ${lead.nivel}. Que carrera o programa cursas?`;
  }

  if (!lead.tema) {
    return `${saludo} Excelente, ${lead.carrera} de ${lead.nivel}. Y cual es el tema de tu ${proyectoLabel.toLowerCase()}?`;
  }

  if (!lead.paginas) {
    return `${saludo} Tu tema sobre "${lead.tema}" suena muy interesante. Aproximadamente cuantas paginas necesitas?`;
  }

  if (!lead.fecha_entrega) {
    return `${saludo} Ya casi tengo todo! Solo me falta saber: para cuando necesitas tu ${proyectoLabel.toLowerCase()} de ${lead.paginas} paginas?`;
  }

  return `${saludo} Ya tengo todos tus datos para cotizarte. Voy a preparar tu cotizacion en un momento. Tienes alguna duda mientras tanto?`;
}

async function main() {
  console.log('Consultando leads de las ultimas 24h...\n');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=gte.${since}&estado_sofia=in.(bienvenida,calificando,cotizando)&modo_humano=eq.false&select=wa_id,nombre,estado_sofia,updated_at,historial_chat,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega`;

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
    const msg = buildSofiaContextualMessage(lead);

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
        // Mostrar donde se quedo el lead
        const missingField = !lead.tipo_servicio ? 'tipo_servicio' : !lead.tipo_proyecto ? 'tipo_proyecto' : !lead.nivel ? 'nivel' : !lead.carrera ? 'carrera' : !lead.tema ? 'tema' : !lead.paginas ? 'paginas' : !lead.fecha_entrega ? 'fecha_entrega' : 'completo';
        console.log(`  OK: ${lead.nombre || lead.wa_id} (${lead.estado_sofia}) — falta: ${missingField}`);

        // Actualizar historial
        let historial = [];
        const raw = lead.historial_chat;
        if (Array.isArray(raw)) historial = raw;
        else if (typeof raw === 'string' && raw.trim()) {
          try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
        }
        historial.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString(), isReengagement: true });

        await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ historial_chat: JSON.stringify(historial), updated_at: new Date().toISOString() }),
        });
      } else {
        failed++;
        console.log(`  FAIL: ${lead.nombre || lead.wa_id} — ${waData.error?.message || JSON.stringify(waData).substring(0, 150)}`);
      }
    } catch (e) {
      failed++;
      console.log(`  ERROR: ${lead.nombre || lead.wa_id} — ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nResultado: ${sent} enviados, ${failed} fallidos de ${leads.length} leads`);
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
