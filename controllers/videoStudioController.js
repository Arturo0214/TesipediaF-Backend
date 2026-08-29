// controllers/videoStudioController.js
// Estudio de Video: 3 canales faceless (spoilers, libro-vs-pelicula, tiktok).
// El admin crea/genera guiones; un worker local los renderiza (edge-tts + imagenes
// IA + ffmpeg) y sube el mp4 a Cloudinary. Semi-auto: el admin revisa y aprueba.
import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';
import VideoProject from '../models/VideoProject.js';

// Config de los 3 canales (espejo de faceless-studio/channels.json)
export const CHANNELS = {
  spoilers: {
    nombre: 'Spoilers general (anime / pelis / mangas)',
    plataforma: 'youtube',
    formatos: ['vertical', 'horizontal'],
    estiloVisual: 'dark cinematic anime and film still, dramatic rim lighting, high contrast, moody atmosphere, highly detailed, 8k',
    voces: { es: 'es-MX-JorgeNeural', en: 'en-US-GuyNeural' },
    rate: '+8%',
    hashtags: ['#anime', '#spoilers', '#pelicula', '#manga', '#final'],
    hookReglas: "Primera frase = choque o pregunta. Nunca revelar el giro en los primeros 3s: prometerlo.",
  },
  'libro-vs-pelicula': {
    nombre: 'Libro vs Pelicula',
    plataforma: 'youtube',
    formatos: ['vertical', 'horizontal'],
    estiloVisual: 'split contrast cinematic, warm book tone versus cold film tone, dramatic, storytelling illustration, highly detailed',
    voces: { es: 'es-MX-DaliaNeural', en: 'en-US-JennyNeural' },
    rate: '+5%',
    hashtags: ['#librovspelicula', '#bookvsmovie', '#lectura', '#cine', '#adaptacion'],
    hookReglas: "Primera frase = la diferencia mas fuerte. 3-5 diferencias, la mas jugosa al final.",
  },
  tiktok: {
    nombre: 'TikTok (spoilers y curiosidades, vertical)',
    plataforma: 'tiktok',
    formatos: ['vertical'],
    estiloVisual: 'punchy cinematic, saturated colors, high contrast, dramatic, scroll-stopping, highly detailed',
    voces: { es: 'es-MX-JorgeNeural', en: 'en-US-GuyNeural' },
    rate: '+12%',
    hashtags: ['#fyp', '#parati', '#anime', '#spoiler', '#pelicula'],
    hookReglas: "Ritmo rapido, hook en el primer segundo, 1 sola idea, loop al final.",
  },
};

// GET /video-studio/channels
export const getChannels = asyncHandler(async (_req, res) => {
  res.json(CHANNELS);
});

// GET /video-studio?canal=&status=
export const listVideos = asyncHandler(async (req, res) => {
  const filtro = {};
  if (req.query.canal) filtro.canal = req.query.canal;
  if (req.query.status) filtro.status = req.query.status;
  const videos = await VideoProject.find(filtro).sort({ updatedAt: -1 }).limit(300);
  res.json(videos);
});

// GET /video-studio/:id
export const getVideo = asyncHandler(async (req, res) => {
  const v = await VideoProject.findById(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  res.json(v);
});

// POST /video-studio
export const createVideo = asyncHandler(async (req, res) => {
  const { canal } = req.body;
  if (!CHANNELS[canal]) { res.status(400); throw new Error('Canal invalido'); }
  const cfg = CHANNELS[canal];
  const v = await VideoProject.create({
    canal,
    idioma: req.body.idioma || 'es',
    formato: req.body.formato || cfg.formatos[0],
    titulo: req.body.titulo || '',
    estiloVisual: req.body.estiloVisual || cfg.estiloVisual,
    escenas: req.body.escenas || [],
    descripcion: req.body.descripcion || '',
    tags: req.body.tags || [],
    hashtags: req.body.hashtags?.length ? req.body.hashtags : cfg.hashtags,
    thumbnailPrompt: req.body.thumbnailPrompt || '',
    status: req.body.escenas?.length ? 'guion' : 'idea',
    source: req.body.source || 'manual',
  });
  res.status(201).json(v);
});

// PATCH /video-studio/:id
export const updateVideo = asyncHandler(async (req, res) => {
  const v = await VideoProject.findById(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  const campos = ['idioma', 'formato', 'titulo', 'estiloVisual', 'escenas',
    'descripcion', 'tags', 'hashtags', 'thumbnailPrompt', 'status', 'publishedUrl'];
  campos.forEach((c) => { if (req.body[c] !== undefined) v[c] = req.body[c]; });
  await v.save();
  res.json(v);
});

// DELETE /video-studio/:id
export const deleteVideo = asyncHandler(async (req, res) => {
  const v = await VideoProject.findByIdAndDelete(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  res.json({ ok: true });
});

// POST /video-studio/:id/enqueue  -> lo manda a la cola de render
export const enqueueRender = asyncHandler(async (req, res) => {
  const v = await VideoProject.findById(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  if (!v.escenas?.length) { res.status(400); throw new Error('El video no tiene escenas'); }
  v.status = 'render_pending';
  v.error = '';
  await v.save();
  res.json(v);
});

// POST /video-studio/:id/approve
export const approveVideo = asyncHandler(async (req, res) => {
  const v = await VideoProject.findById(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  v.status = 'approved';
  await v.save();
  res.json(v);
});

// POST /video-studio/:id/publish  { publishedUrl }
export const publishVideo = asyncHandler(async (req, res) => {
  const v = await VideoProject.findById(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  v.status = 'published';
  if (req.body.publishedUrl) v.publishedUrl = req.body.publishedUrl;
  await v.save();
  res.json(v);
});

// ── Generacion de guion con IA (usa ANTHROPIC_API_KEY) ──
// POST /video-studio/generate  { canal, idioma, tema, formato }
export const generateScript = asyncHandler(async (req, res) => {
  const { canal, idioma = 'es', tema, formato } = req.body;
  if (!CHANNELS[canal]) { res.status(400); throw new Error('Canal invalido'); }
  if (!tema) { res.status(400); throw new Error('Falta el tema'); }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500); throw new Error('Falta ANTHROPIC_API_KEY en el backend');
  }
  const cfg = CHANNELS[canal];
  const fmt = formato || cfg.formatos[0];
  const nEscenas = fmt === 'horizontal' ? '8 a 14' : '4 a 7';
  const lang = idioma === 'en' ? 'INGLES' : 'ESPANOL (Mexico, neutro)';

  const prompt = `Eres guionista de un canal faceless de "${cfg.nombre}". Idioma: ${lang}.
Tema del video: "${tema}".
Reglas de hook del canal: ${cfg.hookReglas}
Formato: ${fmt}. Genera de ${nEscenas} escenas.

Cada escena tiene:
- "narracion": 1-2 frases cortas que dira la voz (naturales para TTS, con puntuacion clara).
- "imagen": un prompt EN INGLES para generar la imagen IA de esa escena (visual, cinematografico, sin texto, sin logos, sin marcas registradas ni nombres de personajes con copyright; describe la escena de forma generica y evocadora).

Devuelve SOLO un JSON valido (sin markdown, sin explicacion) con esta forma exacta:
{
  "titulo": "titulo atractivo para YouTube/TikTok",
  "descripcion": "descripcion de 1-2 lineas",
  "tags": ["tag1","tag2","tag3","tag4","tag5"],
  "thumbnailPrompt": "prompt en ingles para la miniatura",
  "escenas": [ { "narracion": "...", "imagen": "..." } ]
}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.VIDEO_STUDIO_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    res.status(502); throw new Error(`Anthropic error: ${resp.status} ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const texto = data?.content?.[0]?.text || '';
  const jsonMatch = texto.match(/\{[\s\S]*\}/);
  if (!jsonMatch) { res.status(502); throw new Error('La IA no devolvio JSON'); }
  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { res.status(502); throw new Error('JSON invalido de la IA'); }

  const v = await VideoProject.create({
    canal,
    idioma,
    formato: fmt,
    titulo: parsed.titulo || tema,
    estiloVisual: cfg.estiloVisual,
    escenas: Array.isArray(parsed.escenas) ? parsed.escenas : [],
    descripcion: parsed.descripcion || '',
    tags: parsed.tags || [],
    hashtags: cfg.hashtags,
    thumbnailPrompt: parsed.thumbnailPrompt || '',
    status: 'guion',
    source: 'ia',
  });
  res.status(201).json(v);
});

// ── Endpoints del worker local (auth por x-worker-token) ──

// GET /video-studio/worker/next  -> reclama el siguiente job pendiente
export const workerNext = asyncHandler(async (_req, res) => {
  const v = await VideoProject.findOneAndUpdate(
    { status: 'render_pending' },
    { status: 'rendering', renderStartedAt: new Date() },
    { sort: { updatedAt: 1 }, new: true },
  );
  if (!v) return res.json(null);
  const cfg = CHANNELS[v.canal] || {};
  res.json({
    id: v._id,
    canal: v.canal,
    idioma: v.idioma,
    formato: v.formato,
    estiloVisual: v.estiloVisual || cfg.estiloVisual,
    voz: cfg.voces?.[v.idioma],
    rate: cfg.rate,
    escenas: v.escenas,
    titulo: v.titulo,
  });
});

const uploadBuffer = (buffer, opts) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(opts, (err, result) =>
    err ? reject(err) : resolve(result));
  stream.end(buffer);
});

// POST /video-studio/worker/:id/complete  (multipart: video, [thumbnail])
export const workerComplete = asyncHandler(async (req, res) => {
  const v = await VideoProject.findById(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  const videoFile = req.files?.video?.[0];
  if (!videoFile) { res.status(400); throw new Error('Falta el archivo de video'); }

  const up = await uploadBuffer(videoFile.buffer, {
    resource_type: 'video', folder: 'faceless-studio',
    public_id: `${v.canal}-${v._id}`,
  });
  v.videoUrl = up.secure_url;
  v.duracionSeg = Math.round(up.duration || 0);

  const thumb = req.files?.thumbnail?.[0];
  if (thumb) {
    const tup = await uploadBuffer(thumb.buffer, {
      resource_type: 'image', folder: 'faceless-studio',
      public_id: `${v.canal}-${v._id}-thumb`,
    });
    v.thumbnailUrl = tup.secure_url;
  }
  v.status = 'rendered';
  v.renderedAt = new Date();
  v.error = '';
  await v.save();
  res.json({ ok: true, videoUrl: v.videoUrl });
});

// POST /video-studio/worker/:id/error  { error }
export const workerError = asyncHandler(async (req, res) => {
  const v = await VideoProject.findById(req.params.id);
  if (!v) { res.status(404); throw new Error('Video no encontrado'); }
  v.status = 'error';
  v.error = (req.body?.error || 'error desconocido').slice(0, 500);
  await v.save();
  res.json({ ok: true });
});
