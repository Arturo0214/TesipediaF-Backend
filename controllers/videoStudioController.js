// controllers/videoStudioController.js
// Estudio de Contenido: panel de control del sistema de contenido automatizado.
// Gestiona los 13 destinos (tabla `canales`) y la cola de piezas (tabla `contenido`)
// en Supabase. El worker local (youtube-faceless) y n8n consumen la cola directamente;
// aquí solo vive la capa de admin (crear/generar/aprobar/publicar).
import asyncHandler from 'express-async-handler';
import supabaseAdmin from '../config/supabaseAdmin.js';
import cloudinary from '../config/cloudinary.js';

const ESTADOS = ['idea', 'guion_listo', 'aprobado', 'renderizando', 'render_ok', 'publicado', 'error'];
const SEL = '*, canal:canales(id,marca,plataforma,idioma,formato_default,activo)';

const guard = (res) => {
  if (!supabaseAdmin) {
    res.status(503);
    throw new Error('Supabase no configurado: falta SUPABASE_SERVICE_ROLE_KEY en el backend');
  }
};

// GET /video-studio/channels  -> los 13 destinos
export const getChannels = asyncHandler(async (_req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from('canales').select('*').order('id');
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// PATCH /video-studio/channels/:id  { activo?, cadencia?, formato_default?, credencial_ref? }
export const updateChannel = asyncHandler(async (req, res) => {
  guard(res);
  const patch = {};
  ['activo', 'cadencia', 'formato_default', 'credencial_ref'].forEach((c) => {
    if (req.body[c] !== undefined) patch[c] = req.body[c];
  });
  const { data, error } = await supabaseAdmin
    .from('canales').update(patch).eq('id', req.params.id).select().single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// GET /video-studio?canal_id=&estado=
export const listVideos = asyncHandler(async (req, res) => {
  guard(res);
  let q = supabaseAdmin.from('contenido').select(SEL)
    .order('created_at', { ascending: false }).limit(300);
  if (req.query.canal_id) q = q.eq('canal_id', req.query.canal_id);
  if (req.query.estado) q = q.eq('estado', req.query.estado);
  const { data, error } = await q;
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// GET /video-studio/:id
export const getVideo = asyncHandler(async (req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from('contenido').select(SEL)
    .eq('id', req.params.id).single();
  if (error) { res.status(404); throw new Error('Contenido no encontrado'); }
  res.json(data);
});

// POST /video-studio  { canal_id, tema?, guion?, programado_para? }
export const createVideo = asyncHandler(async (req, res) => {
  guard(res);
  const { canal_id, tema, guion, programado_para } = req.body;
  if (!canal_id) { res.status(400); throw new Error('Falta canal_id'); }
  const estado = guion && guion.trim() ? 'guion_listo' : 'idea';
  const { data, error } = await supabaseAdmin.from('contenido')
    .insert({ canal_id, tema: tema || '', guion: guion || '', estado, programado_para: programado_para || null })
    .select(SEL).single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.status(201).json(data);
});

// PATCH /video-studio/:id
export const updateVideo = asyncHandler(async (req, res) => {
  guard(res);
  const patch = {};
  ['tema', 'guion', 'estado', 'ruta_mp4', 'programado_para', 'error'].forEach((c) => {
    if (req.body[c] !== undefined) patch[c] = req.body[c];
  });
  if (patch.estado && !ESTADOS.includes(patch.estado)) { res.status(400); throw new Error('estado inválido'); }
  const { data, error } = await supabaseAdmin.from('contenido')
    .update(patch).eq('id', req.params.id).select(SEL).single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// DELETE /video-studio/:id
export const deleteVideo = asyncHandler(async (req, res) => {
  guard(res);
  const { error } = await supabaseAdmin.from('contenido').delete().eq('id', req.params.id);
  if (error) { res.status(500); throw new Error(error.message); }
  res.json({ ok: true });
});

// POST /video-studio/:id/approve  -> estado 'aprobado' (lo toma el worker)
export const approveVideo = asyncHandler(async (req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from('contenido')
    .update({ estado: 'aprobado', error: null }).eq('id', req.params.id).select(SEL).single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// POST /video-studio/:id/publish  -> estado 'publicado'
export const publishVideo = asyncHandler(async (req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from('contenido')
    .update({ estado: 'publicado', publicado_en: new Date().toISOString() })
    .eq('id', req.params.id).select(SEL).single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// ============================================================
//  CONTENIDO DE REDES (imágenes) — tabla `contenido_social`
//  El mismo Estudio muestra, además del video, las piezas de imagen
//  (frase, carrusel, checklist, comparativa, diccionario, prueba, oferta).
// ============================================================
const ESTADOS_SOCIAL = ['borrador', 'programado', 'publicado', 'error'];
const SLOTS_SOCIAL = ['A', 'B', 'C', 'D', 'E', 'F'];
const MAX_POR_DIA = 3;              // máximo de publicaciones por día
const HORA_NUEVA = '17:00';         // hora fija para publicaciones agregadas manualmente (5 PM)

// POST /video-studio/social  { fecha, marca?, formato?, hora?, tema?, slot? }
// Crea una pieza vacía (borrador) para una fecha, eligiendo el próximo slot libre.
// Sirve para agregar una 3ª+ publicación a un día o para llenar el calendario a futuro.
export const createSocial = asyncHandler(async (req, res) => {
  guard(res);
  const fecha = String(req.body.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { res.status(400); throw new Error('Fecha inválida (usa YYYY-MM-DD)'); }
  const marca = String(req.body.marca || 'Tesipedia');

  // slots ya ocupados ese día (para esa marca no aplica: el índice único es (fecha,slot))
  const { data: existentes, error: e1 } = await supabaseAdmin
    .from('contenido_social').select('slot').eq('fecha', fecha);
  if (e1) { res.status(500); throw new Error(e1.message); }
  if ((existentes || []).length >= MAX_POR_DIA) {
    res.status(409); throw new Error(`Ese día ya tiene el máximo de ${MAX_POR_DIA} publicaciones. Usa otra fecha.`);
  }
  const ocupados = new Set((existentes || []).map((r) => r.slot));
  const slot = req.body.slot && SLOTS_SOCIAL.includes(req.body.slot) && !ocupados.has(req.body.slot)
    ? req.body.slot
    : SLOTS_SOCIAL.find((s) => !ocupados.has(s));
  if (!slot) { res.status(409); throw new Error(`Ese día ya tiene el máximo de ${MAX_POR_DIA} publicaciones. Usa otra fecha.`); }

  const fila = {
    dia: 0,
    fecha,
    slot,
    hora: `${HORA_NUEVA}:00`,
    pilar: String(req.body.pilar || 'Manual'),
    formato: String(req.body.formato || 'CARRUSEL'),
    tema: String(req.body.tema || 'Nueva publicación'),
    titular: '',
    laminas: [],
    copy: '',
    cta: '',
    hashtags: '',
    imagenes: [],
    plataformas: ['ig', 'fb'],
    estado: 'borrador',
    marca,
  };
  const { data, error } = await supabaseAdmin.from('contenido_social').insert(fila).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.status(201).json(data);
});

// GET /video-studio/social?estado=&formato=&marca=
export const listSocial = asyncHandler(async (req, res) => {
  guard(res);
  let q = supabaseAdmin.from('contenido_social').select('*')
    .order('fecha', { ascending: true }).order('slot', { ascending: true }).limit(600);
  if (req.query.estado) q = q.eq('estado', req.query.estado);
  if (req.query.formato) q = q.eq('formato', req.query.formato);
  if (req.query.marca) q = q.eq('marca', req.query.marca);
  const { data, error } = await q;
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// PATCH /video-studio/social/:id  { titular?, copy?, cta?, hashtags?, laminas?, estado?, programado? }
export const updateSocial = asyncHandler(async (req, res) => {
  guard(res);
  const patch = {};
  ['titular', 'copy', 'cta', 'hashtags', 'laminas', 'estado', 'tema'].forEach((c) => {
    if (req.body[c] !== undefined) patch[c] = req.body[c];
  });
  if (patch.estado && !ESTADOS_SOCIAL.includes(patch.estado)) { res.status(400); throw new Error('estado inválido'); }
  const { data, error } = await supabaseAdmin.from('contenido_social')
    .update(patch).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// POST /video-studio/social/:id/approve  -> 'programado' (listo para publicar)
export const approveSocial = asyncHandler(async (req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from('contenido_social')
    .update({ estado: 'programado', nota_error: null }).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// POST /video-studio/social/:id/discard  -> 'borrador' (fuera de la cola)
export const discardSocial = asyncHandler(async (req, res) => {
  guard(res);
  const { data, error } = await supabaseAdmin.from('contenido_social')
    .update({ estado: 'borrador' }).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// POST /video-studio/social/:id/imagen  (multipart: imagen + index)
// Reemplaza (o agrega) una imagen de la pieza: sube a Cloudinary y actualiza imagenes[index].
export const uploadSocialImage = asyncHandler(async (req, res) => {
  guard(res);
  if (!req.file) { res.status(400); throw new Error('No se envió ninguna imagen'); }
  const idx = parseInt(req.body.index ?? '0', 10);

  const { data: row, error: e1 } = await supabaseAdmin
    .from('contenido_social').select('imagenes').eq('id', req.params.id).single();
  if (e1 || !row) { res.status(404); throw new Error('Pieza no encontrada'); }
  const imgs = Array.isArray(row.imagenes) ? [...row.imagenes] : [];

  // Reusa el public_id existente (sobrescribe en su lugar) o crea uno nuevo.
  const existente = imgs[idx];
  const m = existente && existente.match(/\/upload\/(?:v\d+\/)?(redes\/[^.]+)/);
  const publicId = m ? m[1] : `redes/manual_${req.params.id}_${idx}_${Date.now()}`;

  const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId, overwrite: true, invalidate: true, resource_type: 'image',
  });

  if (idx >= 0 && idx < imgs.length) imgs[idx] = result.secure_url;
  else imgs.push(result.secure_url);

  const { data, error } = await supabaseAdmin.from('contenido_social')
    .update({ imagenes: imgs }).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// ── Publicación real a Meta (IG + FB) ──
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FB_PAGE_ID || '855962324262046';
const IG_USER_ID = process.env.IG_USER_ID || '17841477846360365';
const GV = 'v21.0';

async function graph(path, params = {}, method = 'POST', token = META_TOKEN) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const opt = method === 'GET' ? {} : { method, body };
  const url = method === 'GET'
    ? `https://graph.facebook.com/${GV}/${path}?${body.toString()}`
    : `https://graph.facebook.com/${GV}/${path}`;
  const r = await fetch(url, opt);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'Error de Meta');
  return data;
}

// Publicar en Page/IG requiere el PAGE token (no el de usuario). Lo obtenemos de /me/accounts.
let _pageToken = null;
async function getPageToken() {
  if (_pageToken) return _pageToken;
  try {
    const d = await graph('me/accounts', {}, 'GET');
    const pg = (d.data || []).find((p) => p.id === FB_PAGE_ID);
    _pageToken = pg?.access_token || META_TOKEN; // fallback si ya es page token
  } catch { _pageToken = META_TOKEN; }
  return _pageToken;
}

async function publicarFB(imgs, caption, token) {
  if (imgs.length === 1) {
    const r = await graph(`${FB_PAGE_ID}/photos`, { url: imgs[0], caption }, 'POST', token);
    return r.post_id || r.id;
  }
  const ids = [];
  for (const u of imgs) { const r = await graph(`${FB_PAGE_ID}/photos`, { url: u, published: 'false' }, 'POST', token); ids.push(r.id); }
  const r = await graph(`${FB_PAGE_ID}/feed`, { message: caption, attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))) }, 'POST', token);
  return r.id;
}
async function publicarIG(imgs, caption, token) {
  let creation;
  if (imgs.length === 1) {
    creation = (await graph(`${IG_USER_ID}/media`, { image_url: imgs[0], caption }, 'POST', token)).id;
  } else {
    const hijos = [];
    for (const u of imgs) { const c = await graph(`${IG_USER_ID}/media`, { image_url: u, is_carousel_item: 'true' }, 'POST', token); hijos.push(c.id); }
    creation = (await graph(`${IG_USER_ID}/media`, { media_type: 'CAROUSEL', children: hijos.join(','), caption }, 'POST', token)).id;
  }
  return (await graph(`${IG_USER_ID}/media_publish`, { creation_id: creation }, 'POST', token)).id;
}

// POST /video-studio/social/:id/publish  -> publica en IG + FB según plataformas
export const publishSocial = asyncHandler(async (req, res) => {
  guard(res);
  if (!META_TOKEN) { res.status(503); throw new Error('Falta META_ACCESS_TOKEN en el backend'); }
  const { data: p, error } = await supabaseAdmin.from('contenido_social').select('*').eq('id', req.params.id).single();
  if (error || !p) { res.status(404); throw new Error('Pieza no encontrada'); }
  const imgs = (p.imagenes || []).filter(Boolean);
  if (!imgs.length) { res.status(400); throw new Error('La pieza no tiene imágenes'); }
  const caption = `${p.copy || ''}\n\n${p.hashtags || ''}`.trim();
  const plats = p.plataformas || ['ig', 'fb'];
  const pageToken = await getPageToken();
  const patch = {};
  const errores = [];
  if (plats.includes('fb')) { try { patch.fb_post_id = await publicarFB(imgs, caption, pageToken); } catch (e) { errores.push(`FB: ${e.message}`); } }
  if (plats.includes('ig')) { try { patch.ig_media_id = await publicarIG(imgs, caption, pageToken); } catch (e) { errores.push(`IG: ${e.message}`); } }
  const ok = patch.fb_post_id || patch.ig_media_id;
  patch.estado = ok ? 'publicado' : 'error';
  if (ok) patch.publicado_en = new Date().toISOString();
  patch.nota_error = errores.length ? errores.join(' | ') : null;
  const { data } = await supabaseAdmin.from('contenido_social').update(patch).eq('id', p.id).select('*').single();
  if (!ok) { res.status(502); throw new Error(errores.join(' | ') || 'No se pudo publicar'); }
  res.json(data);
});

// ── Auto-publicación programada (switch on/off) ──
export async function getAutopubFlag() {
  try {
    const { data } = await supabaseAdmin.from('app_config').select('valor').eq('clave', 'social_autopublish').single();
    return data?.valor === true || data?.valor === 'true';
  } catch { return false; }
}
export const getAutopublish = asyncHandler(async (req, res) => {
  guard(res);
  res.json({ enabled: await getAutopubFlag() });
});
export const setAutopublish = asyncHandler(async (req, res) => {
  guard(res);
  const enabled = !!req.body.enabled;
  const { error } = await supabaseAdmin.from('app_config')
    .upsert({ clave: 'social_autopublish', valor: enabled, actualizado_en: new Date().toISOString() });
  if (error) { res.status(500); throw new Error(error.message); }
  res.json({ enabled });
});

// Scheduler: publica las piezas 'programado' cuya fecha+hora (CDMX) ya venció.
let socialPubRunning = false;
export async function runSocialPublishing() {
  if (socialPubRunning || !supabaseAdmin || !META_TOKEN) return;
  if (!(await getAutopubFlag())) return;                 // switch apagado
  socialPubRunning = true;
  try {
    const now = Date.now();
    const { data: rows } = await supabaseAdmin.from('contenido_social')
      .select('*').eq('estado', 'programado').eq('marca', 'Tesipedia');
    const pageToken = await getPageToken();
    for (const p of rows || []) {
      const imgs = (p.imagenes || []).filter(Boolean);
      if (!p.fecha || !imgs.length) continue;
      const hora = (p.hora || '10:00').slice(0, 5);
      const dueUTC = new Date(`${p.fecha}T${hora}:00-06:00`).getTime(); // CDMX = UTC-6
      if (Number.isNaN(dueUTC) || dueUTC > now || dueUTC < now - 26 * 3600 * 1000) continue; // vencidas ≤26h
      const caption = `${p.copy || ''}\n\n${p.hashtags || ''}`.trim();
      const plats = p.plataformas || ['ig', 'fb'];
      const patch = {}; const errores = [];
      if (plats.includes('fb')) { try { patch.fb_post_id = await publicarFB(imgs, caption, pageToken); } catch (e) { errores.push(`FB: ${e.message}`); } }
      if (plats.includes('ig')) { try { patch.ig_media_id = await publicarIG(imgs, caption, pageToken); } catch (e) { errores.push(`IG: ${e.message}`); } }
      const ok = patch.fb_post_id || patch.ig_media_id;
      patch.estado = ok ? 'publicado' : 'error';
      if (ok) patch.publicado_en = new Date().toISOString();
      patch.nota_error = errores.length ? errores.join(' | ') : null;
      await supabaseAdmin.from('contenido_social').update(patch).eq('id', p.id);
      console.log(`[SocialAuto] dia${p.dia}${p.slot} → ${ok ? 'publicado' : 'error'}`);
    }
  } catch (e) { console.error('[SocialAuto]', e.message); } finally { socialPubRunning = false; }
}

// DELETE /video-studio/social/:id  -> borra la pieza (y el post de FB si existe)
export const deleteSocial = asyncHandler(async (req, res) => {
  guard(res);
  const { data: p } = await supabaseAdmin.from('contenido_social').select('fb_post_id').eq('id', req.params.id).single();
  if (p?.fb_post_id && META_TOKEN) { try { await graph(p.fb_post_id, {}, 'DELETE'); } catch { /* best-effort */ } }
  const { error } = await supabaseAdmin.from('contenido_social').delete().eq('id', req.params.id);
  if (error) { res.status(500); throw new Error(error.message); }
  res.json({ ok: true, igNota: p?.fb_post_id ? undefined : 'Instagram no permite borrar publicaciones por API; hazlo desde la app si aplica.' });
});

// POST /video-studio/social/:id/sugerencias  -> hashtags de tendencia + tips (IA)
export const sugerenciasSocial = asyncHandler(async (req, res) => {
  guard(res);
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503); throw new Error('Falta ANTHROPIC_API_KEY en el backend'); }
  const { data: p } = await supabaseAdmin.from('contenido_social').select('tema,formato,copy,hashtags').eq('id', req.params.id).single();
  const prompt = `Eres estratega de redes de Tesipedia (asesoría de tesis en México; Instagram, Facebook, TikTok).
Pieza — formato ${p?.formato}, tema "${p?.tema}". Hashtags actuales: ${p?.hashtags || '(ninguno)'}.
Según TENDENCIAS del nicho estudiantil/tesis en México (audiencia universitaria, titulación, metodología, APA, antiplagio, IA en tesis), sugiere para más alcance:
- 12 hashtags NUEVOS (no repitas los actuales): mezcla de volumen alto, de nicho y de intención de titulación.
- 3 tips cortos y accionables para mejorar el gancho del pie de foto de esta pieza.
Devuelve EXCLUSIVAMENTE un JSON: {"hashtags":["#..."],"tips":["..."]}. Sin texto extra, sin markdown.`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.CONTENT_STUDIO_MODEL || 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) { res.status(502); throw new Error('Error de IA'); }
  const data = await resp.json();
  let txt = (data?.content?.[0]?.text || '').trim();
  const m = txt.match(/\{[\s\S]*\}/); if (m) txt = m[0];
  let out; try { out = JSON.parse(txt); } catch { out = { hashtags: [], tips: [] }; }
  res.json(out);
});

// ── Generación de guion con IA (usa ANTHROPIC_API_KEY) ──
// POST /video-studio/generate  { canal_id, tema }
const BRIEFS = {
  Spoilers: 'Canal faceless de spoilers de anime, películas, series y mangas. Hook en la primera frase (un choque o una pregunta), promete el giro sin revelarlo de inmediato y revélalo al final.',
  'Libro vs Película': 'Canal que compara qué pasa en el libro contra la película. Hook = la diferencia más fuerte; da 3 a 5 diferencias, deja la más jugosa para el final.',
  Tesipedia: 'Marca de asesoría de tesis para universitarios. Tono útil y cercano; da un consejo accionable y cierra invitando a Tesipedia. No prometas "hacemos tu tesis".',
  Contratado: 'Marca de empleo: optimización de CV y LinkedIn más bolsa de vacantes. Tono directo y motivador; da un tip accionable de empleabilidad y cierra invitando a Contratado.',
};

export const generateScript = asyncHandler(async (req, res) => {
  guard(res);
  const { canal_id, tema } = req.body;
  if (!canal_id) { res.status(400); throw new Error('Falta canal_id'); }
  if (!tema) { res.status(400); throw new Error('Falta el tema'); }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500); throw new Error('Falta ANTHROPIC_API_KEY en el backend'); }

  const { data: canal, error: ce } = await supabaseAdmin
    .from('canales').select('*').eq('id', canal_id).single();
  if (ce || !canal) { res.status(400); throw new Error('Canal inválido'); }

  const lang = canal.idioma === 'EN' ? 'ENGLISH' : 'ESPAÑOL (México, neutro)';
  const vertical = (canal.formato_default || 'vertical') === 'vertical';
  const dur = vertical ? '30-45 segundos' : '60-90 segundos';
  const brief = BRIEFS[canal.marca] || `Canal de ${canal.marca}.`;

  const prompt = `Eres guionista de un canal faceless. ${brief}
Idioma de salida: ${lang}. Plataforma: ${canal.plataforma}. Duración objetivo: ${dur}.
Tema del video: "${tema}".

Escribe SOLO el guion de narración (exactamente lo que dirá la voz), en texto plano.
Frases cortas y naturales para text-to-speech, con buena puntuación.
Sin encabezados, sin acotaciones de escena, sin markdown, sin hashtags, sin emojis.
Empieza con un hook fuerte en la primera frase.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.CONTENT_STUDIO_MODEL || process.env.VIDEO_STUDIO_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    res.status(502); throw new Error(`Anthropic error: ${resp.status} ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const guion = (data?.content?.[0]?.text || '').trim();
  if (!guion) { res.status(502); throw new Error('La IA no devolvió guion'); }

  const { data: row, error } = await supabaseAdmin.from('contenido')
    .insert({ canal_id, tema, guion, estado: 'guion_listo' })
    .select(SEL).single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.status(201).json(row);
});
