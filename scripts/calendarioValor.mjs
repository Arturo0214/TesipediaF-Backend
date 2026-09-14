#!/usr/bin/env node
// Genera un CALENDARIO DE VALOR: asigna a cada slot de Tesipedia un tema específico y
// distinto (rotando por formato, sin repetir) desde el banco compartido. Escribe el tema
// en contenido_social y (opcional) limpia la imagen para que se regenere con el nuevo tema.
// Luego generarRedesImg.mjs produce la imagen desde ese tema.
//
//   node scripts/calendarioValor.mjs --desde 2026-09-25 --dry     # solo muestra el calendario
//   node scripts/calendarioValor.mjs --desde 2026-09-25 --limpiar # asigna temas + limpia mis imágenes (redes-ig) para regenerar
//   node scripts/calendarioValor.mjs --desde 2026-09-25           # asigna temas, sin limpiar
import 'dotenv/config';
import { CARRUSEL_TEMAS, BANCOS } from './lib/temasRedes.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DESDE = arg('--desde', new Date().toISOString().slice(0, 10));
const HASTA = arg('--hasta', '2026-12-31');
const DRY = process.argv.includes('--dry');
const LIMPIAR = process.argv.includes('--limpiar');

const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
const FORMATOS = ['FRASE', 'DICCIONARIO', 'CHECKLIST', 'COMPARATIVA', 'PRUEBA', 'OFERTA', 'CARRUSEL'];
// Slots que ya están bien y NO se tocan (23A, 23B carrusel APA, 24A).
const KEEP = new Set([29, 30, 31]);

const banco = (fmt) => fmt === 'CARRUSEL' ? CARRUSEL_TEMAS.map((c) => c.titulo) : (BANCOS[fmt] || ['tesis']);

async function main() {
  const url = `${SB}/rest/v1/contenido_social?select=id,fecha,slot,formato,tema,imagenes`
    + `&marca=eq.Tesipedia&fecha=gte.${DESDE}&fecha=lte.${HASTA}&formato=in.(${FORMATOS.join(',')})`
    + `&order=fecha.asc,slot.asc`;
  const r = await fetch(url, { headers: H });
  const slots = await r.json();
  if (!r.ok) throw new Error(slots.message || JSON.stringify(slots));

  const idx = {}; // contador por formato para rotar
  const plan = [];
  for (const s of slots) {
    const tieneImg = Array.isArray(s.imagenes) && s.imagenes.length > 0;
    const esMio = tieneImg && /redes-ig/.test(String(s.imagenes[0] || ''));
    // SEGURIDAD: no tocar slots con imagen del usuario (los salto sin consumir tema).
    if (tieneImg && !esMio) continue;
    // Slots conservados: RESERVAN su tema (avanzan el contador) para no duplicar en los siguientes.
    if (KEEP.has(s.id)) { idx[s.formato] = (idx[s.formato] ?? -1) + 1; continue; }
    const b = banco(s.formato);
    const i = (idx[s.formato] = (idx[s.formato] ?? -1) + 1);
    const tema = b[i % b.length];
    plan.push({ ...s, temaNuevo: tema, esMio, tieneImg });
  }

  // Mostrar calendario
  console.log(`\n📅 CALENDARIO DE VALOR · ${DESDE} → ${HASTA} · ${plan.length} slots\n`);
  let dia = '';
  for (const p of plan) {
    if (p.fecha !== dia) { console.log(`\n── ${p.fecha} ──`); dia = p.fecha; }
    const flag = p.esMio ? (LIMPIAR ? '↻ regenera' : '(tiene img mía)') : p.tieneImg ? '(img del usuario, NO toco)' : '· vacío';
    console.log(`  ${p.slot} ${p.formato.padEnd(11)} → ${p.temaNuevo}   ${flag}`);
  }

  if (DRY) { console.log('\n(DRY: no escribí nada)'); return; }

  // Escribir temas (+ limpiar mis imágenes si --limpiar). NUNCA toco imágenes del usuario (no redes-ig).
  let temas = 0, limpiados = 0;
  for (const p of plan) {
    const fila = { tema: p.temaNuevo };
    if (LIMPIAR && p.esMio) { Object.assign(fila, { imagenes: [], titular: '', copy: '', cta: '', hashtags: '' }); }
    const rr = await fetch(`${SB}/rest/v1/contenido_social?id=eq.${p.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(fila) });
    if (!rr.ok) { console.error('✗ id', p.id, await rr.text()); continue; }
    temas++; if (LIMPIAR && p.esMio) limpiados++;
  }
  console.log(`\n✅ ${temas} temas asignados${LIMPIAR ? ` · ${limpiados} imágenes mías limpiadas para regenerar` : ''}.`);
  console.log('Ahora corre: node scripts/generarRedesImg.mjs --desde ' + DESDE + ' --dias 20');
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
