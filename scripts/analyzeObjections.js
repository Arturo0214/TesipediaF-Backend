// scripts/analyzeObjections.js
// Loop de inteligencia conversacional (#4): cruza los pagadores reales (Mongo)
// con las conversaciones (Supabase) para extraer los "rebatidos ganadores"
// (objeción → lo que se dijo → cerró) vs. dónde se cayeron las perdidas, y le
// pide a Claude un playbook de manejo de objeciones para Sofia y los agentes.
//
// Uso: node scripts/analyzeObjections.js
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
dotenv.config();

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const OBJ = /(caro|est[aá] alto|elevado|costoso|presupuesto|no me alcanza|mucho dinero|no cuento con|desconf|es confiable|estafa|fraude|garant[ií]a|es real|lo pienso|lo voy a pensar|d[eé]jame ver|lo checo|m[aá]s adelante|ahorita no|todav[ií]a no|descuento|m[aá]s barato)/i;
const clip = (s, n = 280) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function main() {
  // 1) Pagadores reales
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const [q, pay] = await Promise.all([
    db.collection('generatedquotes').find({ status: 'paid' }, { projection: { clientPhone: 1 } }).toArray(),
    db.collection('payments').find({ status: 'completed' }, { projection: { clientPhone: 1 } }).toArray(),
  ]);
  const payers = new Set([...q, ...pay].map((x) => last10(x.clientPhone)).filter((p) => p.length === 10));
  await mongoose.disconnect();

  // 2) Conversaciones desde Supabase
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
  const H = { apikey: K, Authorization: 'Bearer ' + K };
  let leads = [], from = 0;
  while (true) {
    const r = await fetch(`${U}/rest/v1/leads?select=wa_id,carrera,historial_chat&order=wa_id`, {
      headers: { ...H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    leads.push(...rows); from += 1000;
    if (rows.length < 1000) break;
  }

  const parseH = (raw) => {
    try { if (typeof raw === 'string') return JSON.parse(raw.replace(/^=/, '')); } catch { return []; }
    return Array.isArray(raw) ? raw : [];
  };

  // Extrae ventana alrededor de la 1ª objeción + el cierre de la conversación
  const extractWindow = (h) => {
    const idx = h.findIndex((m) => m?.role === 'user' && OBJ.test((m.content || '').toLowerCase()));
    if (idx === -1) return null;
    const around = h.slice(Math.max(0, idx - 1), idx + 4)
      .map((m) => `${m.role === 'user' ? 'CLIENTE' : 'TESIPEDIA'}: ${clip(m.content)}`);
    const tail = h.slice(-4)
      .map((m) => `${m.role === 'user' ? 'CLIENTE' : 'TESIPEDIA'}: ${clip(m.content)}`);
    return { objecion: around, cierre: tail };
  };

  const won = [], lost = [];
  for (const l of leads) {
    const h = parseH(l.historial_chat);
    if (!Array.isArray(h) || h.length < 3) continue;
    const userTxt = h.filter((m) => m?.role === 'user').map((m) => m.content || '').join(' ').toLowerCase();
    if (!OBJ.test(userTxt)) continue;
    const w = extractWindow(h);
    if (!w) continue;
    const rec = { carrera: l.carrera || '?', ...w };
    if (payers.has(last10(l.wa_id))) won.push(rec); else lost.push(rec);
  }

  // Muestra acotada para no gastar tokens de más
  const lostSample = lost.slice(0, 45);
  console.log(`Ganadas con objeción: ${won.length} | Perdidas con objeción (muestra): ${lostSample.length}/${lost.length}`);

  const datasetForClaude = {
    ganadas: won.map((w) => ({ carrera: w.carrera, objecion: w.objecion, cierre: w.cierre })),
    perdidas: lostSample.map((w) => ({ carrera: w.carrera, objecion: w.objecion, final: w.cierre })),
  };

  // 3) Claude: sintetiza el playbook
  const TOKEN = process.env.ANTHROPIC_API_KEY;
  if (!TOKEN) { console.error('Falta ANTHROPIC_API_KEY'); process.exit(1); }

  const system = `Eres un estratega de ventas B2C para Tesipedia, un servicio mexicano de elaboración y asesoría de tesis. Analizas conversaciones reales de WhatsApp entre el negocio (Sofia, un bot, y agentes humanos) y estudiantes (leads).

Contexto del negocio y palancas reales disponibles:
- Esquemas de pago en parcialidades (33-33-34, 50-50, quincenales, mensuales) — clave para objeciones de presupuesto.
- Entrega por etapas con validación de avances antes de seguir pagando — clave para desconfianza.
- Muestras reales de tesis (PDF) y casos de éxito / testimonios para mandar.
- Precio depende de nivel, páginas y urgencia.

Tu tarea: a partir de las conversaciones GANADAS (el cliente objetó y aun así compró) y PERDIDAS (objetó y se cayó), produce un PLAYBOOK de manejo de objeciones accionable, en español mexicano, con el tono cálido y directo que ya usa Tesipedia. Devuelve SOLO JSON válido con esta forma:
{
  "resumen": "2-3 frases sobre el patrón principal de por qué se pierden las objeciones y qué hacen distinto las ganadas",
  "objeciones": [
    {
      "categoria": "precio_alto | presupuesto_bajo | desconfianza | lo_pensare | pide_descuento | tiempo_urgencia",
      "que_dice_el_cliente": ["frases textuales típicas"],
      "por_que_se_pierde": "el error común que mata la venta (basado en las perdidas)",
      "rebatido_ganador": "el guion recomendado, listo para usar, en 1-3 mensajes cortos de WhatsApp",
      "referencia_a_mandar": "qué mandar de apoyo (muestra de tesis, testimonio, desglose de pagos, etc.)",
      "que_evitar": "qué NO hacer"
    }
  ]
}`;

  const userMsg = `Aquí están las conversaciones reales (recortadas a la ventana de la objeción y el cierre):\n\n${JSON.stringify(datasetForClaude, null, 1)}\n\nGenera el playbook JSON.`;

  const approxIn = Math.round((system.length + userMsg.length) / 4);
  console.log(`~${approxIn} tokens de entrada. Llamando a Claude…`);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': TOKEN, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const j = await r.json();
  if (!r.ok) { console.error('Claude error:', JSON.stringify(j).slice(0, 400)); process.exit(1); }

  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const usage = j.usage || {};
  console.log(`Tokens: in=${usage.input_tokens} out=${usage.output_tokens}`);

  // Extraer el JSON del playbook
  let playbook;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    playbook = JSON.parse(m ? m[0] : text);
  } catch (e) {
    console.error('No se pudo parsear el JSON. Respuesta cruda guardada.');
    playbook = { raw: text };
  }

  const outDir = path.join(os.homedir(), 'Desktop', 'Claude-Code');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonFile = path.join(outDir, `sofia-playbook-objeciones-${stamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify({ generadoDe: { ganadas: won.length, perdidas: lostSample.length }, playbook }, null, 2));
  console.log('Playbook guardado en:', jsonFile);

  // Vista rápida
  if (playbook.objeciones) {
    console.log('\n=== RESUMEN ===\n' + (playbook.resumen || ''));
    for (const o of playbook.objeciones) {
      console.log(`\n### ${o.categoria}`);
      console.log('  Rebatido:', clip(o.rebatido_ganador, 200));
      console.log('  Referencia:', clip(o.referencia_a_mandar, 120));
    }
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
