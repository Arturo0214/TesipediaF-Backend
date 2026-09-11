// controllers/noticiasController.js
// Motor de Noticias/Artículos de Tesipedia. La GENERACIÓN con IA corre en LOCAL con el Claude CLI
// (scripts/generarNoticias.mjs) para no gastar tokens de API; aquí vive la capa de admin
// (listar/editar/aprobar/publicar), los endpoints públicos y la recolección de titulares (RSS, gratis).
import asyncHandler from 'express-async-handler';
import supabaseAdmin from '../config/supabaseAdmin.js';

const TABLA = 'tesipedia_noticias';
const CATEGORIAS = ['tesis', 'metodologia', 'ia-academica', 'titulacion', 'becas', 'vida-universitaria'];

// Fuentes RSS (Google News) por categoría, enfocadas al nicho tesis/universitario MX.
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=es-419&gl=MX&ceid=MX:es-419`;
const FUENTES = {
  tesis: gnews('tesis OR titulación universidad México'),
  metodologia: gnews('metodología de investigación OR investigación científica México'),
  'ia-academica': gnews('inteligencia artificial en la educación OR IA académica universidad'),
  titulacion: gnews('titulación OR examen profesional universidad México'),
  becas: gnews('becas estudiantes universidad México'),
  'vida-universitaria': gnews('estudiantes universitarios México vida universitaria'),
};

const slugify = (s) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);

function guard(res) {
  if (!supabaseAdmin) { res.status(503); throw new Error('Supabase no configurado en el backend'); }
}

// Extrae titulares de un feed RSS sin dependencias (regex sobre el XML).
async function leerRSS(url, max = 8) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const xml = await r.text();
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const bloque = m[1];
    const titulo = (bloque.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (bloque.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) || [])[1] || '';
    const fuente = (bloque.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/) || [])[1] || 'Google News';
    if (titulo) items.push({ titulo: titulo.trim(), link: link.trim(), fuente: fuente.trim() });
  }
  return items;
}

// ── Público ──
// GET /noticias
export const listPublicas = asyncHandler(async (req, res) => {
  guard(res);
  const { data } = await supabaseAdmin.from(TABLA)
    .select('slug,titulo,resumen,categoria,imagen,autor,publicado_at')
    .eq('estado', 'publicado').order('publicado_at', { ascending: false }).limit(200);
  res.json({ noticias: data || [] });
});
// GET /noticias/:slug
export const getPublica = asyncHandler(async (req, res) => {
  guard(res);
  const { data } = await supabaseAdmin.from(TABLA)
    .select('slug,titulo,resumen,cuerpo,categoria,imagen,autor,fuente_url,fuente_nombre,tags,publicado_at')
    .eq('slug', req.params.slug).eq('estado', 'publicado').maybeSingle();
  if (!data) { res.status(404); throw new Error('Noticia no encontrada'); }
  res.json(data);
});

// ── Admin ──
// GET /admin/noticias
export const listNoticias = asyncHandler(async (req, res) => {
  guard(res);
  const { data } = await supabaseAdmin.from(TABLA)
    .select('id,slug,titulo,resumen,categoria,estado,origen,imagen,autor,publicado_at,created_at,updated_at')
    .order('created_at', { ascending: false }).limit(500);
  res.json({ noticias: data || [] });
});
// GET /admin/noticias/:id
export const getNoticia = asyncHandler(async (req, res) => {
  guard(res);
  const { data } = await supabaseAdmin.from(TABLA).select('*').eq('id', req.params.id).maybeSingle();
  if (!data) { res.status(404); throw new Error('No encontrada'); }
  res.json(data);
});
// POST /admin/noticias
export const crearNoticia = asyncHandler(async (req, res) => {
  guard(res);
  const b = req.body || {};
  const titulo = String(b.titulo || '').trim();
  if (!titulo) { res.status(400); throw new Error('Falta el título'); }
  const fila = {
    slug: (b.slug && slugify(b.slug)) || `${slugify(titulo)}-${Date.now().toString(36)}`,
    titulo, resumen: b.resumen || '', cuerpo: b.cuerpo || '',
    categoria: CATEGORIAS.includes(b.categoria) ? b.categoria : 'tesis',
    imagen: b.imagen || null, autor: b.autor || 'Redacción Tesipedia',
    estado: b.estado === 'publicado' ? 'publicado' : 'borrador',
    origen: b.origen || 'manual', fuente_url: b.fuente_url || null, fuente_nombre: b.fuente_nombre || null,
    tags: Array.isArray(b.tags) ? b.tags : [],
    publicado_at: b.estado === 'publicado' ? new Date().toISOString() : null,
  };
  const { data, error } = await supabaseAdmin.from(TABLA).insert(fila).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.status(201).json(data);
});
// PATCH /admin/noticias/:id
export const actualizarNoticia = asyncHandler(async (req, res) => {
  guard(res);
  const patch = { updated_at: new Date().toISOString() };
  ['titulo', 'resumen', 'cuerpo', 'categoria', 'imagen', 'autor', 'tags', 'fuente_url', 'fuente_nombre', 'slug'].forEach((c) => {
    if (req.body[c] !== undefined) patch[c] = c === 'slug' ? slugify(req.body[c]) : req.body[c];
  });
  const { data, error } = await supabaseAdmin.from(TABLA).update(patch).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});
// POST /admin/noticias/:id/publicar   y   /despublicar
export const publicarNoticia = asyncHandler(async (req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from(TABLA)
    .update({ estado: 'publicado', publicado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  // dispara rebuild del front (prerender/sitemap) si hay hook configurado
  if (process.env.NETLIFY_BUILD_HOOK) fetch(process.env.NETLIFY_BUILD_HOOK, { method: 'POST' }).catch(() => {});
  res.json(data);
});
export const despublicarNoticia = asyncHandler(async (req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from(TABLA)
    .update({ estado: 'borrador', updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});
// DELETE /admin/noticias/:id
export const borrarNoticia = asyncHandler(async (req, res) => {
  guard(res);
  const { error } = await supabaseAdmin.from(TABLA).delete().eq('id', req.params.id);
  if (error) { res.status(500); throw new Error(error.message); }
  res.json({ ok: true });
});
// GET /admin/noticias/tendencias?cats=tesis,becas  → titulares RSS en vivo (para el UI / script local)
export const tendencias = asyncHandler(async (req, res) => {
  const cats = String(req.query.cats || '').split(',').map((s) => s.trim()).filter((c) => FUENTES[c]);
  const usar = cats.length ? cats : CATEGORIAS;
  const out = {};
  await Promise.all(usar.map(async (c) => { try { out[c] = await leerRSS(FUENTES[c], 6); } catch { out[c] = []; } }));
  res.json({ tendencias: out, categorias: CATEGORIAS });
});
// POST /admin/noticias/recolectar { categoria }  → crea 1 DIGEST editorial (GRATIS, sin IA) como borrador
export const recolectarNoticias = asyncHandler(async (req, res) => {
  guard(res);
  const categoria = FUENTES[req.body?.categoria] ? req.body.categoria : 'tesis';
  const items = await leerRSS(FUENTES[categoria], 8);
  if (!items.length) { res.status(502); throw new Error('No se pudieron leer titulares'); }
  const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
  const titulo = `Lo más relevante en ${categoria.replace('-', ' ')} · ${hoy}`;
  const lista = items.map((i) => `<li><a href="${i.link}" target="_blank" rel="noopener">${i.titulo}</a> <span>— ${i.fuente}</span></li>`).join('\n');
  const cuerpo = `<p>Un resumen editorial de lo que se está moviendo esta semana para estudiantes y tesistas. Curado por Redacción Tesipedia.</p>\n<h2>Titulares de la semana</h2>\n<ul>\n${lista}\n</ul>\n<p>¿Trabajas en tu tesis? En Tesipedia te acompañamos en metodología, redacción y titulación.</p>`;
  const fila = {
    slug: `${slugify(titulo)}-${Date.now().toString(36)}`, titulo,
    resumen: `Resumen de titulares de ${categoria.replace('-', ' ')} de la semana.`,
    cuerpo, categoria, autor: 'Redacción Tesipedia', estado: 'borrador', origen: 'resumen',
    tags: [categoria, 'resumen'],
  };
  const { data, error } = await supabaseAdmin.from(TABLA).insert(fila).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.status(201).json(data);
});
