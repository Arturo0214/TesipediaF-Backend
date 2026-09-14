// Reasigna el `tema` de los slots PENDIENTES de Contratado (sin imagen) a los temas nuevos,
// anclados a los productos reales (analizador, plantillas, AdaptaCV, planes…). No toca slots
// que ya tienen imagen. Los carruseles reciben los temas de producto primero (rotan CARRUSEL_TEMAS).
//   node scripts/reorientarContratado.mjs --desde 2026-09-12 --hasta 2026-09-30 [--dry]
import 'dotenv/config';
import { CARRUSEL_TEMAS, BANCOS } from './lib/temasContratado.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DESDE = arg('--desde', '2026-09-12');
const HASTA = arg('--hasta', '2026-09-30');
const DRY = process.argv.includes('--dry');
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };

const PILAR = { FRASE: 'CV/ATS', COMPARATIVA: 'CV/ATS', CHECKLIST: 'CV/ATS', DICCIONARIO: 'Reclutamiento', VACANTE: 'Vacantes', CARRUSEL: 'Guía', OFERTA: 'Oferta', PRUEBA: 'Prueba' };
const idx = {};
const temaDe = (fmt) => {
  const banco = fmt === 'CARRUSEL' ? CARRUSEL_TEMAS.map((c) => c.titulo) : (BANCOS[fmt] || ['empleo']);
  const i = (idx[fmt] = (idx[fmt] ?? -1) + 1);
  return banco[i % banco.length];
};

async function main() {
  const r = await fetch(`${SB}/rest/v1/contenido_social?select=id,fecha,slot,formato,tema,imagenes&marca=eq.Contratado&fecha=gte.${DESDE}&fecha=lte.${HASTA}&order=fecha.asc,slot.asc`, { headers: H });
  const d = await r.json(); if (!r.ok) throw new Error(d.message || JSON.stringify(d));
  const pend = d.filter((s) => !Array.isArray(s.imagenes) || s.imagenes.length === 0);
  console.log(`🔁 Contratado ${DESDE}→${HASTA}: ${d.length} slots, ${d.length - pend.length} con imagen (intactos), ${pend.length} pendientes a reorientar\n`);

  let dia = '', ok = 0;
  for (const s of pend) {
    const nuevo = temaDe(s.formato);
    if (s.fecha !== dia) { console.log(`── ${s.fecha} ──`); dia = s.fecha; }
    console.log(`  ${s.slot} ${s.formato.padEnd(11)} → ${nuevo.slice(0, 64)}`);
    if (DRY) continue;
    const u = await fetch(`${SB}/rest/v1/contenido_social?id=eq.${s.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ tema: nuevo, pilar: PILAR[s.formato] || s.formato }) });
    if (!u.ok) { console.error('   ✗', await u.text()); continue; }
    ok++;
  }
  console.log(DRY ? '\n(DRY: no escribí nada)' : `\n✅ ${ok} slots reorientados a productos reales. Ahora regenera con --marca Contratado.`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
