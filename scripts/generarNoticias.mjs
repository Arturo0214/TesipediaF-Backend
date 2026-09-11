#!/usr/bin/env node
// Generación LOCAL de noticias con el Claude CLI (sin API key / sin gastar tokens).
// Lee titulares reales (Google News RSS), los parafrasea con `claude -p` y guarda BORRADORES
// en Supabase (tesipedia_noticias). Luego los apruebas/publicas desde /admin → Noticias.
//
//   node scripts/generarNoticias.mjs [categoria] [cuántas]
//   npm run noticia                 → 1 de categoría rotada
//   npm run noticia -- tesis 3      → 3 de "tesis"
import 'dotenv/config';
import { execFileSync } from 'node:child_process';

// REST directo de Supabase (evita el cliente supabase-js, que en Node<22 truena por realtime/ws).
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLA = 'tesipedia_noticias';
const sbHeaders = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
async function sbInsert(fila) {
  const r = await fetch(`${SB}/rest/v1/${TABLA}`, { method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify(fila) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || JSON.stringify(d));
  return Array.isArray(d) ? d[0] : d;
}
async function sbExisteTitulo(frag) {
  const r = await fetch(`${SB}/rest/v1/${TABLA}?select=id&titulo=ilike.${encodeURIComponent('%' + frag + '%')}&limit=1`, { headers: sbHeaders });
  const d = await r.json().catch(() => []);
  return Array.isArray(d) && d.length > 0;
}
const CATS = ['tesis', 'metodologia', 'ia-academica', 'titulacion', 'becas', 'vida-universitaria'];
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=es-419&gl=MX&ceid=MX:es-419`;
const FUENTES = {
  tesis: gnews('tesis OR titulación universidad México'),
  metodologia: gnews('metodología de investigación México'),
  'ia-academica': gnews('inteligencia artificial educación universidad'),
  titulacion: gnews('titulación examen profesional universidad México'),
  becas: gnews('becas estudiantes universidad México'),
  'vida-universitaria': gnews('estudiantes universitarios México'),
};
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);

async function leerRSS(url, max = 8) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const xml = await r.text();
  const items = []; const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const b = m[1];
    const t = (b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const l = (b.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) || [])[1] || '';
    const f = (b.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/) || [])[1] || 'Google News';
    if (t) items.push({ titulo: t.trim(), link: l.trim(), fuente: f.trim() });
  }
  return items;
}
const claude = (prompt) => execFileSync('claude', ['-p', prompt], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });

async function yaExisteTitular(titulo) {
  try { return await sbExisteTitulo(titulo.slice(0, 40)); } catch { return false; }
}

async function generarUno(categoria) {
  const items = await leerRSS(FUENTES[categoria], 8);
  if (!items.length) { console.log('· sin titulares para', categoria); return; }
  const it = items[Math.floor(Math.random() * items.length)];
  if (await yaExisteTitular(it.titulo)) { console.log('· ya existe, salto:', it.titulo.slice(0, 50)); return; }
  const prompt = `Eres redactor de Tesipedia (asesoría de tesis para universitarios en México). A partir de este TITULAR real, escribe un artículo ORIGINAL (parafraseado, NO copies), útil y con enfoque estudiantil/tesis.
Titular: "${it.titulo}" (fuente: ${it.fuente})
Categoría: ${categoria}
Devuelve EXCLUSIVAMENTE un JSON válido (sin markdown, sin texto fuera del JSON):
{"titulo":"...","resumen":"1-2 frases, máx 155 caracteres","cuerpo":"HTML con <h2>,<p>,<ul>,<li>, 450-700 palabras, tono cercano y útil; cierra invitando a Tesipedia sin prometer 'hacemos tu tesis'","tags":["3-6 tags"]}`;
  let raw; try { raw = claude(prompt); } catch (e) { console.error('· error del Claude CLI:', e.message); return; }
  const m = raw.match(/\{[\s\S]*\}/); if (!m) { console.error('· la IA no devolvió JSON'); return; }
  let art; try { art = JSON.parse(m[0]); } catch { console.error('· JSON inválido de la IA'); return; }
  const base = slugify(art.titulo || it.titulo);
  const slug = `${base}-${Date.now().toString(36)}`;
  const fila = {
    slug, titulo: art.titulo || it.titulo, resumen: (art.resumen || '').slice(0, 180),
    cuerpo: art.cuerpo || '', categoria, autor: 'Redacción Tesipedia', estado: 'borrador', origen: 'auto',
    fuente_url: it.link, fuente_nombre: it.fuente, tags: Array.isArray(art.tags) ? art.tags : [categoria],
  };
  let data; try { data = await sbInsert(fila); } catch (e) { console.error('· error guardando:', e.message); return; }
  console.log(`✅ borrador #${data.id}: ${data.titulo}`);
}

const argCat = process.argv[2];
const count = parseInt(process.argv[3] || '1', 10);
const cats = argCat && FUENTES[argCat] ? [argCat] : CATS;
(async () => {
  if (!SB || !SK) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_KEY en .env'); process.exit(1); }
  console.log(`Generando ${count} noticia(s) con el Claude CLI local…`);
  for (let i = 0; i < count; i++) {
    const c = cats[i % cats.length];
    console.log(`\n— (${c}) ${i + 1}/${count} —`);
    await generarUno(c);
  }
  console.log('\nListo. Revisa y publica desde /admin → Noticias.');
})();
