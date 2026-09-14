// Rankea TODO el contenido generado (contenido_social) con el mismo evaluador del Estudio
// (Frontend/.../viralidad.js) y da veredicto por pieza: score, tier, factores flojos, qué cambiar.
//   node scripts/rankearViralidad.mjs [--marca Tesipedia|Contratado|ambas] [--desde 2026-09-01]
import 'dotenv/config';
import { scoreViralidad } from '../../Frontend/src/pages/admin/adminVideoStudio/viralidad.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const MARCA = arg('--marca', 'ambas');
const DESDE = arg('--desde', '2026-09-01');
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SK, Authorization: `Bearer ${SK}` };

async function traer(marca) {
  const r = await fetch(`${SB}/rest/v1/contenido_social?select=fecha,slot,marca,formato,tema,copy,hashtags,imagenes,video_url,titular&marca=eq.${marca}&fecha=gte.${DESDE}&order=fecha,slot`, { headers: H });
  const d = await r.json(); if (!r.ok) throw new Error(JSON.stringify(d));
  return d.filter((p) => (p.imagenes || []).length || p.video_url); // solo lo que YA tiene contenido
}

function barra(pts, max) { const n = Math.round((pts / max) * 8); return '█'.repeat(n) + '░'.repeat(8 - n); }

async function main() {
  const marcas = MARCA === 'ambas' ? ['Tesipedia', 'Contratado'] : [MARCA];
  const filas = [];
  for (const m of marcas) for (const p of await traer(m)) {
    const v = scoreViralidad({ formato: p.formato, copy: p.copy, hashtags: p.hashtags, video_url: p.video_url }, p);
    filas.push({ ...p, ...v });
  }
  filas.sort((a, b) => b.score - a.score);

  const alto = filas.filter((f) => f.tier === 'alto'), medio = filas.filter((f) => f.tier === 'medio'), bajo = filas.filter((f) => f.tier === 'bajo');
  const reels = filas.filter((f) => f.video_url || f.formato === 'VIDEO').length;
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  RANKING DE VIRALIDAD · ${filas.length} piezas generadas`);
  console.log(`  🔥 Alto (≥70): ${alto.length}   ⚠️ Ajustar (45-69): ${medio.length}   ❌ Bajo (<45): ${bajo.length}`);
  console.log(`  Reels de video: ${reels}/${filas.length}  ← palanca #1 (100% de tus top reales son reels)`);
  console.log(`${'='.repeat(74)}`);

  const linea = (f) => {
    const flojo = f.factores.filter((x) => x.pts / x.max < 0.5).map((x) => x.k).join(', ');
    console.log(`\n  [${String(f.score).padStart(3)}] ${f.tier === 'alto' ? '🔥' : f.tier === 'medio' ? '⚠️ ' : '❌'} ${f.marca[0]}·${f.fecha.slice(5)}${f.slot || ''} ${f.formato.padEnd(10)} — ${(f.tema || f.titular || '').slice(0, 52)}`);
    console.log(`        flojo en: ${flojo || '—'}`);
    if (f.sugerencias[0]) console.log(`        cambiar: ${f.sugerencias[0]}`);
  };

  console.log(`\n\n### 🔝 TOP 12 (lo que más impacto puede tener)`);
  filas.slice(0, 12).forEach(linea);
  console.log(`\n\n### 🚨 BOTTOM 10 (bajo alcance — replantear o volver reel)`);
  filas.slice(-10).forEach(linea);

  // Diagnóstico agregado: dónde falla el lote
  const prom = (k) => { const fs = filas.map((f) => f.factores.find((x) => x.k === k)); return `${Math.round(100 * fs.reduce((s, x) => s + x.pts, 0) / fs.reduce((s, x) => s + x.max, 0))}%`; };
  console.log(`\n\n${'='.repeat(74)}\n### DIAGNÓSTICO DEL LOTE (promedio por factor, % del máximo)`);
  for (const k of ['formato', 'gancho', 'retencion', 'dolor', 'sends', 'seo', 'conversacion']) {
    const f0 = filas[0].factores.find((x) => x.k === k);
    console.log(`  ${k.padEnd(13)} ${barra(0, 1).replace(/./g, '')}${prom(k).padStart(4)}  ${f0 ? '' : ''}`);
  }
  // conteo de sugerencias más repetidas
  const cont = {};
  filas.forEach((f) => f.sugerencias.forEach((s) => { const key = s.slice(0, 45); cont[key] = (cont[key] || 0) + 1; }));
  console.log(`\n### QUÉ CAMBIAR (sugerencias más repetidas en el lote):`);
  Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([s, n]) => console.log(`  (${n}×) ${s}…`));
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
