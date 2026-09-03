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

// GET /video-studio/social?estado=&formato=
export const listSocial = asyncHandler(async (req, res) => {
  guard(res);
  let q = supabaseAdmin.from('contenido_social').select('*')
    .order('fecha', { ascending: true }).order('slot', { ascending: true }).limit(400);
  if (req.query.estado) q = q.eq('estado', req.query.estado);
  if (req.query.formato) q = q.eq('formato', req.query.formato);
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
