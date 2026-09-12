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
const FORMATOS_SOCIAL = ['FRASE', 'CARRUSEL', 'CHECKLIST', 'COMPARATIVA', 'DICCIONARIO', 'PRUEBA', 'OFERTA', 'VIDEO'];
const SLOTS_SOCIAL = ['A', 'B', 'C', 'D', 'E', 'F'];
const MAX_POR_DIA = 4;              // máximo de publicaciones por día
const HORA_NUEVA = '17:00';         // hora fija para publicaciones agregadas manualmente (5 PM)

// POST /video-studio/social  { fecha, marca?, formato?, hora?, tema?, slot? }
// Crea una pieza vacía (borrador) para una fecha, eligiendo el próximo slot libre.
// Sirve para agregar una 3ª+ publicación a un día o para llenar el calendario a futuro.
export const createSocial = asyncHandler(async (req, res) => {
  guard(res);
  const fecha = String(req.body.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { res.status(400); throw new Error('Fecha inválida (usa YYYY-MM-DD)'); }
  const marca = String(req.body.marca || 'Tesipedia');

  // slots ya ocupados ese día PARA ESA MARCA (el único es (fecha,slot,marca)).
  const { data: existentes, error: e1 } = await supabaseAdmin
    .from('contenido_social').select('slot').eq('fecha', fecha).eq('marca', marca);
  if (e1) { res.status(500); throw new Error(e1.message); }
  if ((existentes || []).length >= MAX_POR_DIA) {
    res.status(409); throw new Error(`Ese día ya tiene el máximo de ${MAX_POR_DIA} publicaciones. Usa otra fecha.`);
  }
  const ocupados = new Set((existentes || []).map((r) => r.slot));
  const slot = req.body.slot && SLOTS_SOCIAL.includes(req.body.slot) && !ocupados.has(req.body.slot)
    ? req.body.slot
    : SLOTS_SOCIAL.find((s) => !ocupados.has(s));
  if (!slot) { res.status(409); throw new Error(`Ese día ya tiene el máximo de ${MAX_POR_DIA} publicaciones. Usa otra fecha.`); }

  // plataformas por defecto (desde la barra de canales); sólo redes reales, ig+fb si no llega nada
  const PLATS_OK = ['ig', 'fb', 'tiktok', 'linkedin'];
  const platsIn = Array.isArray(req.body.plataformas) ? req.body.plataformas.filter((p) => PLATS_OK.includes(p)) : [];
  const plataformas = platsIn.length ? [...new Set(platsIn)] : ['ig', 'fb'];

  const formato = String(req.body.formato || 'CARRUSEL');
  const fila = {
    dia: 0,
    fecha,
    slot,
    hora: `${HORA_NUEVA}:00`,
    pilar: String(req.body.pilar || 'Manual'),
    formato,
    tema: String(req.body.tema || 'Nueva publicación'),
    titular: '',
    laminas: [],
    copy: '',
    cta: '',
    hashtags: '',
    imagenes: [],
    plataformas,
    historia: formato !== 'CARRUSEL',   // Historias ON por defecto salvo carruseles
    estado: 'borrador',
    marca,
  };
  const { data, error } = await supabaseAdmin.from('contenido_social').insert(fila).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.status(201).json(data);
});

// PATCH /video-studio/social/:id/mover  { fecha }
// Mueve una pieza a otro día (drag&drop en la cuadrícula): valida máximo por día y asigna slot libre.
export const moverSocial = asyncHandler(async (req, res) => {
  guard(res);
  const fecha = String(req.body.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { res.status(400); throw new Error('Fecha inválida (usa YYYY-MM-DD)'); }
  const { data: pieza, error: e0 } = await supabaseAdmin.from('contenido_social').select('id,fecha,slot,marca').eq('id', req.params.id).single();
  if (e0 || !pieza) { res.status(404); throw new Error('Pieza no encontrada'); }
  if (pieza.fecha === fecha) return res.json(pieza); // mismo día, sin cambios
  const marca = pieza.marca || 'Tesipedia';
  const { data: existentes } = await supabaseAdmin
    .from('contenido_social').select('slot').eq('fecha', fecha).eq('marca', marca);
  if ((existentes || []).length >= MAX_POR_DIA) {
    res.status(409); throw new Error(`Ese día ya tiene el máximo de ${MAX_POR_DIA} publicaciones.`);
  }
  const ocupados = new Set((existentes || []).map((r) => r.slot));
  const slot = SLOTS_SOCIAL.find((s) => !ocupados.has(s));
  if (!slot) { res.status(409); throw new Error(`Ese día ya está lleno.`); }
  const { data, error } = await supabaseAdmin.from('contenido_social')
    .update({ fecha, slot }).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// GET /video-studio/social?estado=&formato=&marca=
export const listSocial = asyncHandler(async (req, res) => {
  guard(res);
  let q = supabaseAdmin.from('contenido_social').select('*')
    .order('fecha', { ascending: true }).order('slot', { ascending: true }).limit(8000);
  if (req.query.estado) q = q.eq('estado', req.query.estado);
  if (req.query.formato) q = q.eq('formato', req.query.formato);
  if (req.query.marca) q = q.eq('marca', req.query.marca);
  if (req.query.desde) q = q.gte('fecha', req.query.desde);
  if (req.query.hasta) q = q.lte('fecha', req.query.hasta);
  const { data, error } = await q;
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// PATCH /video-studio/social/:id  { titular?, copy?, cta?, hashtags?, laminas?, estado?, programado? }
export const updateSocial = asyncHandler(async (req, res) => {
  guard(res);
  const patch = {};
  ['titular', 'copy', 'cta', 'hashtags', 'laminas', 'estado', 'tema', 'formato', 'video_url', 'plataformas', 'hora', 'historia', 'aspecto'].forEach((c) => {
    if (req.body[c] !== undefined) patch[c] = req.body[c];
  });
  if (patch.estado && !ESTADOS_SOCIAL.includes(patch.estado)) { res.status(400); throw new Error('estado inválido'); }
  if (patch.formato && !FORMATOS_SOCIAL.includes(patch.formato)) { res.status(400); throw new Error('formato inválido'); }
  if (patch.aspecto !== undefined && patch.aspecto !== null && !['9:16', '4:5', '1:1'].includes(patch.aspecto)) { res.status(400); throw new Error('aspecto inválido'); }
  if (patch.hora !== undefined) {                                  // normaliza HH:MM (o HH:MM:SS)
    const m = /^([01]?\d|2[0-3]):([0-5]\d)/.exec(String(patch.hora || '').trim());
    if (!m) { res.status(400); throw new Error('hora inválida (usa HH:MM)'); }
    patch.hora = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
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

// POST /video-studio/social/:id/video  (multipart: video)
// Sube un video a Cloudinary (resource_type video), guarda video_url y marca formato VIDEO.
export const uploadSocialVideo = asyncHandler(async (req, res) => {
  guard(res);
  if (!req.file) { res.status(400); throw new Error('No se envió ningún video'); }
  if (!/^video\//.test(req.file.mimetype || '')) { res.status(400); throw new Error('El archivo no es un video'); }

  const publicId = `redes/video_${req.params.id}_${Date.now()}`;
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'video',
        overwrite: true,
        invalidate: true,
        // Transcodifica a mp4/h264/aac: reproducible en navegador y compatible con IG Reels/FB.
        // Async para no bloquear la subida; la URL derivada dispara la misma transformación.
        eager: [{ format: 'mp4', video_codec: 'h264', audio_codec: 'aac' }],
        eager_async: true,
      },
      (err, r) => (err ? reject(err) : resolve(r)),
    );
    stream.end(req.file.buffer);
  });

  // URL mp4/h264 reproducible en <video> y válida para publicar en Meta (no la original .mov/HEVC).
  const playableUrl = cloudinary.url(result.public_id, {
    resource_type: 'video',
    format: 'mp4',
    secure: true,
    transformation: [{ video_codec: 'h264', audio_codec: 'aac', quality: 'auto' }],
  });

  const { data, error } = await supabaseAdmin.from('contenido_social')
    .update({ video_url: playableUrl, formato: 'VIDEO' }).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500); throw new Error(error.message); }
  res.json(data);
});

// ── Publicación real a Meta (IG + FB), multi-marca ──
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const GV = 'v21.0';

// Config de Meta por marca. Tesipedia usa token de USUARIO (deriva el page token);
// Contratado ya trae un PAGE TOKEN directo. Cada marca publica en SUS cuentas.
const BRAND_META = {
  Tesipedia: {
    pageId: process.env.FB_PAGE_ID || '855962324262046',
    igUserId: process.env.IG_USER_ID || '17841477846360365',
    userToken: process.env.META_ACCESS_TOKEN,
  },
  Contratado: {
    pageId: process.env.CONTRATADO_FB_PAGE_ID,
    igUserId: process.env.CONTRATADO_IG_USER_ID,
    pageToken: process.env.CONTRATADO_FB_PAGE_TOKEN,
  },
};

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
// Cache por pageId (varias marcas).
const _pageTokens = {};
async function derivePageToken(pageId, userToken) {
  if (_pageTokens[pageId]) return _pageTokens[pageId];
  try {
    const d = await graph('me/accounts', {}, 'GET', userToken);
    const pg = (d.data || []).find((p) => p.id === pageId);
    _pageTokens[pageId] = pg?.access_token || userToken; // fallback si ya es page token
  } catch { _pageTokens[pageId] = userToken; }
  return _pageTokens[pageId];
}

// Devuelve el contexto Meta listo para publicar { marca, pageId, igUserId, token }.
// null si la marca no tiene credenciales configuradas (se salta, no rompe).
async function getBrandCtx(marca) {
  const key = BRAND_META[marca] ? marca : 'Tesipedia';
  const b = BRAND_META[key];
  if (!b || (!b.pageId && !b.igUserId)) return null;
  let token = b.pageToken;
  if (!token && b.userToken) token = await derivePageToken(b.pageId, b.userToken);
  if (!token) return null;
  return { marca: key, pageId: b.pageId, igUserId: b.igUserId, token };
}

async function publicarFB(imgs, caption, ctx) {
  const { pageId, token } = ctx;
  if (imgs.length === 1) {
    const r = await graph(`${pageId}/photos`, { url: imgs[0], caption }, 'POST', token);
    return r.post_id || r.id;
  }
  const ids = [];
  for (const u of imgs) { const r = await graph(`${pageId}/photos`, { url: u, published: 'false' }, 'POST', token); ids.push(r.id); }
  const r = await graph(`${pageId}/feed`, { message: caption, attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))) }, 'POST', token);
  return r.id;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IG ingiere el image_url de forma ASÍNCRONA. Hay que esperar a que el
// contenedor quede FINISHED antes de media_publish; si no, Meta responde
// "Media ID is not available" y la pieza se publica en FB pero NO en IG.
async function esperarContenedorIG(containerId, token, { intentos = 12, esperaMs = 2500 } = {}) {
  for (let i = 0; i < intentos; i++) {
    const r = await graph(containerId, { fields: 'status_code,status' }, 'GET', token);
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new Error(`contenedor IG ${r.status_code}: ${r.status || 'sin detalle'} (revisa que image_url sea público y ≤8MB, JPG)`);
    }
    await sleep(esperaMs); // IN_PROGRESS → seguir esperando
  }
  throw new Error('el contenedor de IG no quedó listo a tiempo (timeout de procesamiento de imagen)');
}

// Ajusta una imagen de Cloudinary al formato de publicación elegido (9:16, 4:5 o 1:1).
// c_fill recorta al ratio (como muestran las guías del Estudio); f_jpg asegura JPEG.
// Si aspecto es null, deja la imagen tal cual.
function fmtUrl(u, aspecto) {
  if (!aspecto || !/res\.cloudinary\.com/.test(u) || !u.includes('/upload/')) return u;
  return u.replace('/upload/', `/upload/ar_${aspecto},c_fill,g_center,f_jpg,q_auto/`);
}
// Formato efectivo de una pieza: el elegido, o 4:5 por defecto para carrusel (feed IG).
const aspectoDe = (p) => p.aspecto || (p.formato === 'CARRUSEL' ? '4:5' : null);

async function publicarIG(imgs, caption, ctx) {
  const { igUserId, token } = ctx;
  let creation;
  if (imgs.length === 1) {
    creation = (await graph(`${igUserId}/media`, { image_url: imgs[0], caption }, 'POST', token)).id;
    await esperarContenedorIG(creation, token);
  } else {
    const hijos = [];
    for (const u of imgs) {
      // imgs ya vienen normalizadas al aspecto elegido (mismo ratio en todas → sin recorte raro).
      const c = (await graph(`${igUserId}/media`, { image_url: u, is_carousel_item: 'true' }, 'POST', token)).id;
      await esperarContenedorIG(c, token); // cada lámina debe estar lista
      hijos.push(c);
    }
    creation = (await graph(`${igUserId}/media`, { media_type: 'CAROUSEL', children: hijos.join(','), caption }, 'POST', token)).id;
    await esperarContenedorIG(creation, token);
  }
  // Reintento de media_publish por si IG lo marca disponible con unos segundos de retraso.
  let ultimoErr;
  for (let i = 0; i < 3; i++) {
    try {
      return (await graph(`${igUserId}/media_publish`, { creation_id: creation }, 'POST', token)).id;
    } catch (e) {
      ultimoErr = e;
      await sleep(3000);
    }
  }
  throw ultimoErr;
}

// ── Historias (Stories) IG + FB ──
// IG: contenedor media_type=STORIES (imagen o video) → publish. Recomendado 9:16.
async function publicarIGStory(mediaUrl, esVideo, ctx) {
  const { igUserId, token } = ctx;
  const params = esVideo
    ? { media_type: 'STORIES', video_url: playableVideoUrl(mediaUrl) }
    : { media_type: 'STORIES', image_url: mediaUrl };
  const creation = (await graph(`${igUserId}/media`, params, 'POST', token)).id;
  await esperarContenedorIG(creation, token, esVideo ? { intentos: 24, esperaMs: 3000 } : {});
  let ultimoErr;
  for (let i = 0; i < 3; i++) {
    try { return (await graph(`${igUserId}/media_publish`, { creation_id: creation }, 'POST', token)).id; }
    catch (e) { ultimoErr = e; await sleep(3000); }
  }
  throw ultimoErr;
}
// FB Page Stories: foto = subir sin publicar → photo_stories; video = start → upload por file_url → finish.
async function publicarFBStory(mediaUrl, esVideo, ctx) {
  const { pageId, token } = ctx;
  if (esVideo) {
    const start = await graph(`${pageId}/video_stories`, { upload_phase: 'start' }, 'POST', token);
    const videoId = start.video_id;
    const up = await fetch(start.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: playableVideoUrl(mediaUrl) } });
    const upData = await up.json().catch(() => ({}));
    if (upData.error) throw new Error(upData.error.message || 'error subiendo video a historia');
    const fin = await graph(`${pageId}/video_stories`, { upload_phase: 'finish', video_id: videoId }, 'POST', token);
    return fin.post_id || videoId;
  }
  const photo = await graph(`${pageId}/photos`, { url: mediaUrl, published: 'false' }, 'POST', token);
  const r = await graph(`${pageId}/photo_stories`, { photo_id: photo.id }, 'POST', token);
  return r.post_id || r.id || photo.id;
}
// Sube la historia en las redes seleccionadas; acumula errores sin romper el feed.
async function publicarHistorias(p, imgs, esVideo, ctx, plats, errores) {
  const media = esVideo ? p.video_url : imgs[0];
  if (!media) { errores.push('Historia: la pieza no tiene imagen/video'); return; }
  if (plats.includes('ig')) { try { await publicarIGStory(media, esVideo, ctx); } catch (e) { errores.push(`IG Historia: ${e.message}`); } }
  if (plats.includes('fb')) { try { await publicarFBStory(media, esVideo, ctx); } catch (e) { errores.push(`FB Historia: ${e.message}`); } }
}

// Fuerza mp4/h264/aac en URLs de Cloudinary: reproducible y aceptado por IG Reels/FB.
// Arregla también registros viejos guardados con la URL original (.mov/HEVC).
function playableVideoUrl(url) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/video/upload/')) return url;
  if (url.includes('/upload/f_') || url.includes('/upload/vc_')) return url;
  return url
    .replace('/video/upload/', '/video/upload/f_mp4,vc_h264,ac_aac/')
    .replace(/\.(mov|m4v|avi|mkv|webm|mpeg|mpg|3gp|hevc)$/i, '.mp4');
}

// ── LinkedIn (por marca) ──
// Versión ACTIVA de la LinkedIn REST API (formato YYYYMM). LinkedIn desactiva las versiones
// tras ~1 año, así que hay que subirla ~1 vez al año. NO usar el env viejo (traía 202506 =
// junio 2025, ya desactivada → error "version not active"). Bumpear cuando falle.
const LI_VERSION = '202608';
const LINKEDIN = {
  Contratado: {
    token: process.env.CONTRATADO_LINKEDIN_ACCESS_TOKEN,
    // Para publicar en la PÁGINA de empresa se usa el URN de organización (no el personal).
    // Requiere un token con Community Management API (w_organization_social) — en trámite.
    author: process.env.CONTRATADO_LINKEDIN_ORG || 'urn:li:organization:146333900',
    version: LI_VERSION,
    // LinkedIn queda EN PAUSA hasta que se apruebe el acceso de Página: pon
    // CONTRATADO_LINKEDIN_PAGE_READY=1 (y el token de organización) cuando esté listo.
    pageReady: process.env.CONTRATADO_LINKEDIN_PAGE_READY === '1',
  },
};
function getLinkedInCtx(marca) {
  const c = LINKEDIN[marca];
  if (!c || !c.token || !c.author) return null;
  if (!c.pageReady) return null; // pausado hasta tener acceso de Página (no publica al perfil personal)
  return c;
}
// La Posts API usa "Little Text": hay que escapar reservados. NO escapamos '#'
// (para que los hashtags funcionen) ni '@'.
function liEscape(text) {
  return String(text || '').replace(/[\\|{}\[\]()<>*_~]/g, (m) => '\\' + m);
}
async function liFetch(path, { method = 'POST', ctx, body } = {}) {
  const r = await fetch(`https://api.linkedin.com/rest/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'LinkedIn-Version': ctx.version,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}
// Sube una imagen (desde su URL pública) a LinkedIn y devuelve su URN.
async function liSubirImagen(imgUrl, ctx) {
  const initR = await liFetch('images?action=initializeUpload', {
    ctx, body: { initializeUploadRequest: { owner: ctx.author } },
  });
  const init = await initR.json();
  if (!initR.ok) throw new Error(`init imagen (${init.message || initR.status})`);
  const { uploadUrl, image } = init.value;
  const bytes = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());
  const upR = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `Bearer ${ctx.token}` }, body: bytes });
  if (!upR.ok) throw new Error(`subida de bytes (${upR.status})`);
  return image; // urn:li:image:...
}
// Publica en LinkedIn (imágenes; el video de LinkedIn es otro flujo y se omite por ahora).
async function publicarLinkedIn(imgs, caption, ctx) {
  const urns = [];
  for (const u of imgs.slice(0, 20)) urns.push(await liSubirImagen(u, ctx));
  const content = urns.length === 1
    ? { media: { id: urns[0] } }
    : { multiImage: { images: urns.map((id) => ({ id })) } };
  const r = await liFetch('posts', {
    ctx,
    body: {
      author: ctx.author,
      commentary: liEscape(caption),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content,
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`post (${e.message || r.status})`); }
  return r.headers.get('x-restli-id') || r.headers.get('x-linkedin-id') || 'posted';
}

// Publicación de VIDEO (reel). FB: /videos (asíncrono, best-effort). IG: REELS con polling.
async function publicarVideoFB(videoUrl, caption, ctx) {
  const { pageId, token } = ctx;
  const r = await graph(`${pageId}/videos`, { file_url: playableVideoUrl(videoUrl), description: caption }, 'POST', token);
  return r.id;
}
async function publicarVideoIG(videoUrl, caption, ctx) {
  const { igUserId, token } = ctx;
  const creation = (await graph(`${igUserId}/media`, { media_type: 'REELS', video_url: playableVideoUrl(videoUrl), caption }, 'POST', token)).id;
  await esperarContenedorIG(creation, token, { intentos: 24, esperaMs: 5000 }); // el video tarda más en procesar
  let ultimoErr;
  for (let i = 0; i < 3; i++) {
    try { return (await graph(`${igUserId}/media_publish`, { creation_id: creation }, 'POST', token)).id; }
    catch (e) { ultimoErr = e; await sleep(4000); }
  }
  throw ultimoErr;
}

// POST /video-studio/social/:id/publish  -> publica en IG + FB según plataformas
export const publishSocial = asyncHandler(async (req, res) => {
  guard(res);
  const { data: p, error } = await supabaseAdmin.from('contenido_social').select('*').eq('id', req.params.id).single();
  if (error || !p) { res.status(404); throw new Error('Pieza no encontrada'); }
  const ctx = await getBrandCtx(p.marca || 'Tesipedia');
  if (!ctx) { res.status(503); throw new Error(`Faltan credenciales de Meta para la marca "${p.marca || 'Tesipedia'}" en el backend`); }
  const imgs = (p.imagenes || []).filter(Boolean).map((u) => fmtUrl(u, aspectoDe(p)));
  const esVideo = !!p.video_url;
  if (!esVideo && !imgs.length) { res.status(400); throw new Error('La pieza no tiene imágenes ni video'); }
  const caption = `${p.copy || ''}\n\n${p.hashtags || ''}`.trim();
  const plats = p.plataformas || ['ig', 'fb'];
  const patch = {};
  const errores = [];
  if (plats.includes('fb')) { try { patch.fb_post_id = esVideo ? await publicarVideoFB(p.video_url, caption, ctx) : await publicarFB(imgs, caption, ctx); } catch (e) { errores.push(`FB: ${e.message}`); } }
  if (plats.includes('ig')) { try { patch.ig_media_id = esVideo ? await publicarVideoIG(p.video_url, caption, ctx) : await publicarIG(imgs, caption, ctx); } catch (e) { errores.push(`IG: ${e.message}`); } }
  if (plats.includes('linkedin')) {
    const liCtx = getLinkedInCtx(p.marca || 'Tesipedia');
    if (!liCtx) errores.push('LinkedIn: sin credenciales para esta marca');
    else if (esVideo) errores.push('LinkedIn: el video aún no está soportado (solo imágenes)');
    else { try { patch.linkedin_id = await publicarLinkedIn(imgs, caption, liCtx); } catch (e) { errores.push(`LinkedIn: ${e.message}`); } }
  }
  if (p.historia) await publicarHistorias(p, imgs, esVideo, ctx, plats, errores);
  const ok = patch.fb_post_id || patch.ig_media_id || patch.linkedin_id;
  patch.estado = ok ? 'publicado' : 'error';
  if (ok) patch.publicado_en = new Date().toISOString();
  patch.nota_error = errores.length ? errores.join(' | ') : null;
  const { data } = await supabaseAdmin.from('contenido_social').update(patch).eq('id', p.id).select('*').single();
  if (!ok) { res.status(502); throw new Error(errores.join(' | ') || 'No se pudo publicar'); }
  res.json(data);
});

// GET /video-studio/social/rendimiento-piezas?marca=  → nuestras piezas PUBLICADAS con
// sus métricas reales por-post (vistas/reacciones/comentarios) traídas del Graph API.
// Cache en memoria 10 min por marca para no pegarle al Graph en cada carga.
const _rendPiezasCache = {};
async function piezasConMetricas(marca) {
  const ctx = await getBrandCtx(marca);
  const { data: filas } = await supabaseAdmin.from('contenido_social')
    .select('id,marca,formato,tema,imagenes,video_url,fecha,plataformas,fb_post_id,ig_media_id,linkedin_id,publicado_en')
    .eq('marca', marca).eq('estado', 'publicado')
    .order('publicado_en', { ascending: false }).limit(60);

  // FB: leer métricas por-post desde el FEED de la página (una sola llamada). El nodo directo
  // /{post_id} requiere pages_read_engagement; el feed de la propia página sí se puede leer.
  const fbMap = {};
  const necesitaFB = (filas || []).some((p) => p.fb_post_id);
  if (ctx && ctx.pageId && necesitaFB) {
    try {
      const feed = await graph(`${ctx.pageId}/posts`, { fields: 'id,permalink_url,reactions.summary(true),comments.summary(true),shares', limit: '100' }, 'GET', ctx.token);
      for (const post of feed.data || []) fbMap[post.id] = post;
    } catch { /* sin permiso de lectura de feed → sin métricas FB */ }
  }

  const piezas = [];
  for (const p of filas || []) {
    const item = {
      id: p.id, marca: p.marca, formato: p.formato, tema: p.tema,
      preview: (p.imagenes || [])[0] || null, video: p.video_url || null,
      fecha: p.publicado_en || p.fecha, redes: p.plataformas || [],
      red: null, vistas: null, reacciones: null, comentarios: null, compartidos: null, permalink: null,
    };
    if (ctx) {
      let gotIg = false;
      if (p.ig_media_id) {
        try {
          const m = await graph(`${p.ig_media_id}`, { fields: 'like_count,comments_count,media_type,permalink,thumbnail_url,media_url' }, 'GET', ctx.token);
          item.red = 'ig'; gotIg = true;
          item.reacciones = m.like_count ?? null;
          item.comentarios = m.comments_count ?? null;
          item.permalink = m.permalink || null;
          if (!item.preview) item.preview = m.thumbnail_url || m.media_url || null;
          if (['VIDEO', 'REELS'].includes(m.media_type)) {
            try {
              const ins = await graph(`${p.ig_media_id}/insights`, { metric: 'plays' }, 'GET', ctx.token);
              item.vistas = ins.data?.[0]?.values?.[0]?.value ?? ins.data?.[0]?.total_value?.value ?? null;
            } catch { /* algunas cuentas no exponen plays */ }
          }
        } catch (e) { item.error = e.message; /* IG inválido → intentamos FB abajo */ }
      }
      if (!gotIg && p.fb_post_id) {
        const m = fbMap[p.fb_post_id];
        item.red = 'fb';
        if (m) {
          item.reacciones = m.reactions?.summary?.total_count ?? null;
          item.comentarios = m.comments?.summary?.total_count ?? null;
          item.compartidos = m.shares?.count ?? null;
          item.permalink = m.permalink_url || null;
          item.error = null;
        }
      } else if (!gotIg && !p.fb_post_id && p.linkedin_id) {
        item.red = 'linkedin'; // sin insights por-post disponibles
      }
    }
    piezas.push(item);
  }
  return { marca, piezas, sinCredenciales: !ctx, ts: new Date().toISOString() };
}

export const getRendimientoPiezas = asyncHandler(async (req, res) => {
  guard(res);
  const marca = String(req.query.marca || 'Tesipedia');
  const now = Date.now();
  if (_rendPiezasCache[marca] && now - _rendPiezasCache[marca].at < 10 * 60 * 1000) {
    return res.json(_rendPiezasCache[marca].data);
  }
  const payload = await piezasConMetricas(marca);
  _rendPiezasCache[marca] = { at: now, data: payload };
  res.json(payload);
});

// POST /video-studio/social/diagnostico-ia { marca }  → Claude lee las métricas reales de las
// piezas y devuelve un análisis accionable (qué se hace bien/mal + próximos pasos). Económico (Haiku).
export const diagnosticoIA = asyncHandler(async (req, res) => {
  guard(res);
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503); throw new Error('Falta ANTHROPIC_API_KEY en el backend'); }
  const marca = String(req.body.marca || 'Tesipedia');
  const { piezas } = _rendPiezasCache[marca]?.data || await piezasConMetricas(marca);
  const con = (piezas || []).filter((p) => p.reacciones != null || p.vistas != null);
  if (!con.length) { return res.json({ resumen: 'Aún no hay piezas publicadas con métricas para analizar.', acciones: [] }); }
  const resumen = con.map((p) => `- ${p.formato} "${(p.tema || '').slice(0, 40)}" (${p.red || '?'}): ${p.reacciones ?? '—'} reac, ${p.comentarios ?? '—'} coment, ${p.vistas ?? '—'} vistas`).join('\n');
  const prompt = `Eres analista de redes sociales de ${marca} (Instagram/Facebook). Estas son NUESTRAS publicaciones con sus métricas reales:
${resumen}

Con base SOLO en estos datos, responde en español mexicano, directo y accionable. Devuelve EXCLUSIVAMENTE un JSON:
{"resumen":"2-3 frases: qué estamos haciendo bien y qué mal","acciones":["4-6 acciones concretas y priorizadas para mejorar alcance e interacción"]}
Sin markdown, sin texto fuera del JSON.`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.CONTENT_STUDIO_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) { res.status(502); throw new Error('Error de IA'); }
  const data = await resp.json();
  let txt = (data?.content?.[0]?.text || '').trim();
  const mm = txt.match(/\{[\s\S]*\}/); if (mm) txt = mm[0];
  let out; try { out = JSON.parse(txt); } catch { out = { resumen: txt.slice(0, 400), acciones: [] }; }
  res.json(out);
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
  if (socialPubRunning || !supabaseAdmin) return;
  if (!(await getAutopubFlag())) return;                 // switch apagado
  socialPubRunning = true;
  try {
    const now = Date.now();
    // TODAS las marcas (cada una publica en sus cuentas). Sin credenciales → se salta.
    const { data: rows } = await supabaseAdmin.from('contenido_social')
      .select('*').eq('estado', 'programado');
    const ctxCache = {};
    for (const p of rows || []) {
      const imgs = (p.imagenes || []).filter(Boolean).map((u) => fmtUrl(u, aspectoDe(p)));
      const esVideo = !!p.video_url;
      if (!p.fecha || (!esVideo && !imgs.length)) continue;
      const hora = (p.hora || '10:00').slice(0, 5);
      const dueUTC = new Date(`${p.fecha}T${hora}:00-06:00`).getTime(); // CDMX = UTC-6
      if (Number.isNaN(dueUTC) || dueUTC > now || dueUTC < now - 26 * 3600 * 1000) continue; // vencidas ≤26h
      const marca = p.marca || 'Tesipedia';
      if (!(marca in ctxCache)) ctxCache[marca] = await getBrandCtx(marca);
      const ctx = ctxCache[marca];
      if (!ctx) continue; // marca sin credenciales configuradas → saltar sin marcar error
      const caption = `${p.copy || ''}\n\n${p.hashtags || ''}`.trim();
      const plats = p.plataformas || ['ig', 'fb'];
      const patch = {}; const errores = [];
      if (plats.includes('fb')) { try { patch.fb_post_id = esVideo ? await publicarVideoFB(p.video_url, caption, ctx) : await publicarFB(imgs, caption, ctx); } catch (e) { errores.push(`FB: ${e.message}`); } }
      if (plats.includes('ig')) { try { patch.ig_media_id = esVideo ? await publicarVideoIG(p.video_url, caption, ctx) : await publicarIG(imgs, caption, ctx); } catch (e) { errores.push(`IG: ${e.message}`); } }
      if (plats.includes('linkedin') && !esVideo) {
        const liCtx = getLinkedInCtx(marca);
        if (liCtx) { try { patch.linkedin_id = await publicarLinkedIn(imgs, caption, liCtx); } catch (e) { errores.push(`LinkedIn: ${e.message}`); } }
      }
      if (p.historia) await publicarHistorias(p, imgs, esVideo, ctx, plats, errores);
      const ok = patch.fb_post_id || patch.ig_media_id || patch.linkedin_id;
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
