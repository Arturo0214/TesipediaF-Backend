// Crea/asegura los slots de Contratado para septiembre (3/día: A 09:15, B 13:15, C 19:15)
// con un mix de formatos y temas de VALOR (del banco temasContratado). Upsert por (fecha,slot,marca).
// No pisa slots que ya tienen imagen. Luego: node scripts/generarRedesImg.mjs --marca Contratado ...
//   node scripts/septiembreContratado.mjs --desde 2026-09-12 --hasta 2026-09-30 [--dry]
import 'dotenv/config';
import { CARRUSEL_TEMAS, BANCOS } from './lib/temasContratado.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DESDE = arg('--desde', '2026-09-12');
const HASTA = arg('--hasta', '2026-09-30');
const DRY = process.argv.includes('--dry');
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };

// Patrón diario (rota por índice de día). A=enseña, B=autoridad, C=vende.
const PLAN_A = ['COMPARATIVA', 'FRASE', 'CHECKLIST', 'DICCIONARIO', 'FRASE', 'COMPARATIVA', 'CHECKLIST'];
const PLAN_B = ['CARRUSEL', 'CARRUSEL', 'VACANTE', 'CARRUSEL', 'CARRUSEL', 'VACANTE', 'CARRUSEL'];
const PLAN_C = ['OFERTA', 'PRUEBA', 'OFERTA', 'OFERTA', 'PRUEBA', 'OFERTA', 'OFERTA'];
const HORA = { A: '09:15', B: '13:15', C: '19:15' };
const PILAR = { FRASE: 'CV/ATS', COMPARATIVA: 'CV/ATS', CHECKLIST: 'CV/ATS', DICCIONARIO: 'Reclutamiento', VACANTE: 'Vacantes', CARRUSEL: 'Guía', OFERTA: 'Oferta', PRUEBA: 'Prueba' };

const idx = {};
const temaDe = (fmt) => {
  const banco = fmt === 'CARRUSEL' ? CARRUSEL_TEMAS.map((c) => c.titulo) : (BANCOS[fmt] || ['empleo']);
  const i = (idx[fmt] = (idx[fmt] ?? -1) + 1);
  return banco[i % banco.length];
};

async function existentes() {
  const r = await fetch(`${SB}/rest/v1/contenido_social?select=id,fecha,slot,imagenes&marca=eq.Contratado&fecha=gte.${DESDE}&fecha=lte.${HASTA}`, { headers: H });
  const d = await r.json(); if (!r.ok) throw new Error(d.message || JSON.stringify(d));
  const map = {}; for (const s of d) map[`${s.fecha}_${s.slot}`] = s; return map;
}

function fechas() {
  const out = []; let t = new Date(`${DESDE}T00:00:00Z`); const end = new Date(`${HASTA}T00:00:00Z`);
  while (t <= end) { out.push(t.toISOString().slice(0, 10)); t = new Date(t.getTime() + 864e5); }
  return out;
}

async function main() {
  const ya = await existentes();
  const filas = [];
  fechas().forEach((fecha, d) => {
    for (const [slot, plan] of [['A', PLAN_A], ['B', PLAN_B], ['C', PLAN_C]]) {
      if (ya[`${fecha}_${slot}`]) continue; // NO tocar los slots que ya existen (respeta el sample)
      const formato = plan[d % plan.length];
      const tema = temaDe(formato);
      filas.push({ fecha, slot, hora: HORA[slot], pilar: PILAR[formato], formato, tema,
        titular: '', copy: '', cta: '', hashtags: '', imagenes: [],
        plataformas: ['ig', 'fb', 'linkedin'], estado: 'borrador', marca: 'Contratado',
        historia: formato !== 'CARRUSEL', dia: 3000 + d * 3 + slot.charCodeAt(0) });
    }
  });

  console.log(`📅 CONTRATADO ${DESDE} → ${HASTA} · ${filas.length} slots\n`);
  let dia = '';
  for (const f of filas) { if (f.fecha !== dia) { console.log(`\n── ${f.fecha} ──`); dia = f.fecha; } console.log(`  ${f.slot} ${f.formato.padEnd(11)} → ${f.tema.slice(0, 60)}`); }
  if (DRY) { console.log('\n(DRY: no escribí nada)'); return; }

  // Upsert por (fecha,slot,marca)
  const r = await fetch(`${SB}/rest/v1/contenido_social?on_conflict=fecha,slot,marca`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(filas.map(({ id, ...f }) => f)),
  });
  if (!r.ok) { console.error('✗', await r.text()); process.exit(1); }
  console.log(`\n✅ ${filas.length} slots de Contratado asegurados (septiembre). Ahora genera:`);
  console.log(`   node scripts/generarRedesImg.mjs --marca Contratado --desde ${DESDE} --dias 20 --pausa 30 --turno 25`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
