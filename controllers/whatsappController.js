/**
 * WhatsApp Controller — Panel de administración
 * Conecta con Supabase (leads) y WhatsApp Business API
 */

import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';
import createNotification from '../utils/createNotification.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const WA_PHONE_ID = process.env.WA_PHONE_ID || '978427788691495';
const WA_TOKEN = process.env.WA_TOKEN || '';

// Plantilla aprobada para enviar fuera de la ventana de 24h
const WA_TEMPLATE_NAME = 'seguimiento_tesipedia';
const WA_TEMPLATE_LANG = 'es_MX';
const HOURS_24 = 24 * 60 * 60 * 1000;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

/**
 * Helper: Genera un mensaje contextual de Sofia basado en el ultimo dato recabado del lead.
 * Flujo de calificacion: nombre → tipo_servicio → tipo_proyecto → nivel → carrera → tema → paginas → fecha_entrega
 * El mensaje retoma justo donde el lead se quedo.
 */
function buildSofiaContextualMessage(lead) {
  const nombre = (lead.nombre || '').split(' ')[0];
  const saludo = nombre ? `Hola ${nombre}, soy Sofia de Tesipedia.` : 'Hola! Soy Sofia de Tesipedia.';

  // Estado bienvenida: el lead apenas llego, no ha dado datos
  if (lead.estado_sofia === 'bienvenida') {
    return `${saludo} Vi que nos contactaste pero no alcanzamos a platicar. Me encantaria ayudarte con tu tesis o proyecto academico. Cuentame, que tipo de servicio necesitas? Ofrecemos redaccion completa, correccion de estilo, y asesoria.`;
  }

  // Estado cotizando: ya tiene todos los datos, falta cerrar
  if (lead.estado_sofia === 'cotizando') {
    return `${saludo} Ya tenemos todos tus datos y tu cotizacion esta casi lista! Te la envio en un momento si estas de acuerdo. Quieres que procedamos?`;
  }

  // Estado calificando: detectar el ultimo campo llenado para pedir el siguiente
  // Orden: tipo_servicio → tipo_proyecto → nivel → carrera → tema → paginas → fecha_entrega
  if (!lead.tipo_servicio) {
    return `${saludo} Estabamos platicando sobre tu proyecto. Para ayudarte mejor, cuentame: que tipo de servicio necesitas? Tenemos redaccion completa, correccion de estilo, o asesoria.`;
  }

  const servicioLabel = { servicio_1: 'redaccion completa', servicio_2: 'correccion de estilo', servicio_3: 'asesoria' }[lead.tipo_servicio] || lead.tipo_servicio;

  if (!lead.tipo_proyecto) {
    return `${saludo} Ya me comentaste que necesitas ${servicioLabel}. Ahora cuentame, que tipo de trabajo es? Por ejemplo: tesis, tesina, articulo cientifico, ensayo...`;
  }

  const proyectoLabel = lead.tipo_proyecto || 'tu proyecto';

  if (!lead.nivel) {
    return `${saludo} Veo que estas trabajando en ${proyectoLabel.toLowerCase() === 'otro' ? 'tu proyecto' : 'tu ' + proyectoLabel.toLowerCase()}. De que nivel academico es? Preparatoria, licenciatura, maestria, especialidad, diplomado o doctorado?`;
  }

  if (!lead.carrera) {
    return `${saludo} Ya tengo que es ${proyectoLabel.toLowerCase()} de ${lead.nivel}. Que carrera o programa cursas?`;
  }

  if (!lead.tema) {
    return `${saludo} Excelente, ${lead.carrera} de ${lead.nivel}. Y cual es el tema de tu ${proyectoLabel.toLowerCase()}?`;
  }

  if (!lead.paginas) {
    return `${saludo} Tu tema sobre "${lead.tema}" suena muy interesante. Aproximadamente cuantas paginas necesitas?`;
  }

  if (!lead.fecha_entrega) {
    return `${saludo} Ya casi tengo todo! Solo me falta saber: para cuando necesitas tu ${proyectoLabel.toLowerCase()} de ${lead.paginas} paginas?`;
  }

  // Tiene todos los datos pero sigue en calificando (caso raro)
  return `${saludo} Ya tengo todos tus datos para cotizarte. Voy a preparar tu cotizacion en un momento. Tienes alguna duda mientras tanto?`;
}

/**
 * Helper: determinar si la ventana de 24h expiró
 * Busca el último mensaje del USUARIO (role === 'user') en el historial.
 * Usa updated_at del lead como fallback cuando los mensajes no tienen timestamp
 * (ej. conversaciones que llegan por n8n/Sofía).
 */
function isWindowExpired(historial, updatedAt) {
  if (!Array.isArray(historial) || historial.length === 0) {
    // Sin historial: usar updated_at como fallback
    if (updatedAt) {
      const updTime = new Date(updatedAt).getTime();
      return (Date.now() - updTime) > HOURS_24;
    }
    return true;
  }
  // Buscar el último mensaje del usuario (no del bot/admin)
  const lastUserMsg = [...historial]
    .reverse()
    .find(m => m.role === 'user');
  if (!lastUserMsg) {
    // No hay mensajes de usuario: usar updated_at como fallback
    if (updatedAt) {
      const updTime = new Date(updatedAt).getTime();
      return (Date.now() - updTime) > HOURS_24;
    }
    return true;
  }
  // Si el mensaje tiene timestamp, usarlo; si no, usar updated_at como fallback
  if (lastUserMsg.timestamp) {
    const lastTime = new Date(lastUserMsg.timestamp).getTime();
    return (Date.now() - lastTime) > HOURS_24;
  }
  // Sin timestamp en el mensaje: usar updated_at del lead
  if (updatedAt) {
    const updTime = new Date(updatedAt).getTime();
    return (Date.now() - updTime) > HOURS_24;
  }
  return true;
}

// Helper: generar preview del último mensaje (para el sidebar, sin traer todo el historial)
function buildLastMessagePreview(historial) {
  if (!Array.isArray(historial) || historial.length === 0) return '';
  const last = historial[historial.length - 1];
  let text = last.content || '';
  const role = last.role || '';
  // Limpiar tags internos
  text = text.replace(/^\[HUMANO:[^\]]*\]\s*/, '').replace(/^\[HUMANO\]\s*/, '');
  text = text.replace(/\[STATE:[\s\S]*?\]/g, '').replace(/\[CALCULAR_COTIZACION\]/g, '').trim();
  // Prefijo según rol
  const prefix = role === 'user' ? '👤 ' : '';
  if (!text && last.mediaUrl) text = '📎 Archivo';
  // Truncar a 60 chars
  if (text.length > 60) text = text.substring(0, 60) + '...';
  return prefix + text;
}

// Helper: headers para Supabase
const supabaseHeaders = () => ({
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
});

/**
 * GET /api/v1/whatsapp/leads
 * Obtener todos los leads SIN historial_chat para reducir egress de Supabase.
 * El historial se carga individualmente al seleccionar un lead.
 */
export const getLeads = asyncHandler(async (req, res) => {
  // ESTRATEGIA HÍBRIDA para reducir egress sin perder el preview del último mensaje:
  // 1. Traer metadata de los leads (sin historial_chat)
  // 2. Traer historial_chat de TODOS los leads del lote — para preview + _lastMsgIsUser
  // Nota: se necesita historial de todos para que el frontend pueda ordenar correctamente

  const metaColumns = [
    'wa_id', 'nombre', 'etapa', 'precio', 'datos_cotizacion',
    'created_at', 'updated_at', 'estado_sofia', 'paso_sofia',
    'carrera', 'nivel', 'tipo_servicio', 'tipo_proyecto',
    'paginas', 'paginas_avance', 'tipo_trabajo', 'fecha_entrega',
    'tiene_tema', 'tiene_avance', 'boton_actual', 'control_humano',
    'motivo_intervencion', 'cotizacion_aprobada', 'cotizacion_enviada',
    'tema', 'pdf_url', 'modo_humano', 'atendido_por',
    'mensaje_pendiente', 'ultimo_mensaje_at', 'bloqueado', 'origen', 'manychat_segment',
    'ultimo_mensaje_preview', 'notas_admin', 'etiquetas',
  ].join(',');

  // ── Filtro por origen (query param ?origen=regular|manychat|all) ──
  // Construir todas las condiciones como un array para combinarlas correctamente
  const origenParam = (req.query.origen || 'regular').toLowerCase();
  const andConditions = []; // condiciones AND de nivel top
  const orConditions = [];  // condiciones OR que se combinarán en un solo or=()

  if (origenParam === 'regular') {
    // Excluir leads ManyChat que aún están en bienvenida
    // Lógica: (origen != manychat) OR (origen IS NULL) OR (estado_sofia != bienvenida)
    orConditions.push('origen.neq.manychat', 'origen.is.null', 'estado_sofia.neq.bienvenida');
  } else if (origenParam === 'manychat') {
    andConditions.push('origen=eq.manychat');
  }

  // ── Filtros server-side (query params) ──
  const { estado, atendido, fecha, search } = req.query;
  if (estado && estado !== 'all') {
    if (estado === 'sin_estado') {
      andConditions.push('estado_sofia=is.null');
    } else {
      andConditions.push(`estado_sofia=eq.${encodeURIComponent(estado)}`);
    }
  }
  if (atendido && atendido !== 'all') {
    if (atendido === 'sin_atender') {
      // atendido_por IS NULL o vacío — usar and() para agrupar condiciones OR de atendido
      andConditions.push('or=(atendido_por.is.null,atendido_por.eq.)');
    } else if (atendido === 'atendido') {
      // atendido_por tiene valor no vacío y no nulo
      andConditions.push('not.or=(atendido_por.is.null,atendido_por.eq.)');
    } else {
      // admin específico (arturo, sandy, hugo)
      andConditions.push(`atendido_por=ilike.*${encodeURIComponent(atendido)}*`);
    }
  }
  if (fecha) {
    andConditions.push(`created_at=gte.${fecha}T00:00:00`);
    andConditions.push(`created_at=lt.${fecha}T23:59:59`);
  }
  if (search && search.trim()) {
    const q = encodeURIComponent(search.trim());
    andConditions.push(`or=(nombre.ilike.*${q}*,wa_id.ilike.*${q}*,carrera.ilike.*${q}*,tema.ilike.*${q}*,atendido_por.ilike.*${q}*,ultimo_mensaje_preview.ilike.*${q}*)`);
  }

  // Combinar: un solo or=() para origen, y condiciones AND para el resto
  let extraFilters = '';
  if (orConditions.length > 0) {
    extraFilters += `&or=(${orConditions.join(',')})`;
  }
  for (const cond of andConditions) {
    extraFilters += `&${cond}`;
  }

  // ── Paginación (query params ?limit=100&offset=0) ──
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const paginationParams = `&limit=${limit}&offset=${offset}`;

  // Query 1: metadata de leads filtrados (paginado)
  const allFilters = extraFilters;
  const metaUrl = `${SUPABASE_URL}/rest/v1/leads?select=${metaColumns}${allFilters}&order=updated_at.desc${paginationParams}`;
  // Query 2: historial de los leads del lote (para preview + _lastMsgIsUser correcto)
  const previewUrl = `${SUPABASE_URL}/rest/v1/leads?select=wa_id,historial_chat${allFilters}&order=updated_at.desc&limit=${limit}&offset=${offset}`;
  // Query 3: conteo total (solo header, sin datos)
  const countUrl = `${SUPABASE_URL}/rest/v1/leads?select=wa_id${allFilters}`;

  const [metaResp, previewResp, countResp] = await Promise.all([
    fetch(metaUrl, { headers: supabaseHeaders() }),
    fetch(previewUrl, { headers: supabaseHeaders() }),
    fetch(countUrl, { headers: { ...supabaseHeaders(), 'Prefer': 'count=exact', 'Range': '0-0' } }),
  ]);

  if (!metaResp.ok) {
    const errorText = await metaResp.text();
    res.status(metaResp.status);
    throw new Error(`Error de Supabase: ${errorText}`);
  }

  const allLeads = await metaResp.json();

  // Extraer previews del último mensaje
  const previewMap = new Map();
  if (previewResp.ok) {
    const previewData = await previewResp.json();
    for (const row of previewData) {
      let hist = row.historial_chat;
      if (typeof hist === 'string') {
        try { hist = JSON.parse(hist.replace(/^=/, '')); } catch { hist = []; }
      }
      if (Array.isArray(hist) && hist.length > 0) {
        // Guardar último mensaje como preview + último como historial_chat recortado
        previewMap.set(row.wa_id, {
          preview: buildLastMessagePreview(hist),
          lastMsg: hist[hist.length - 1],
        });
      }
    }
  }

  // Enriquecer leads con preview
  const enriched = allLeads.map(lead => {
    const info = previewMap.get(lead.wa_id);
    if (info) {
      lead.ultimo_mensaje_preview = info.preview;
      // Enviar solo el último mensaje como historial recortado (para unread detection)
      lead.historial_chat = JSON.stringify([info.lastMsg]);
      // Marcar si el último mensaje es del usuario (necesita atención)
      lead._lastMsgIsUser = info.lastMsg?.role === 'user';
    }
    return lead;
  });

  // Ordenar: leads con último mensaje del usuario primero (necesitan respuesta),
  // luego el resto, ambos grupos ordenados por updated_at desc
  enriched.sort((a, b) => {
    const aUser = a._lastMsgIsUser ? 1 : 0;
    const bUser = b._lastMsgIsUser ? 1 : 0;
    if (aUser !== bUser) return bUser - aUser; // user-responded first
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  // Extraer total del count response
  let total = enriched.length + offset; // fallback
  if (countResp.ok) {
    const range = countResp.headers.get('content-range');
    if (range) {
      const m = range.match(/\/(\d+)/);
      if (m) total = parseInt(m[1]);
    }
  }

  res.json({ leads: enriched, total, limit, offset, hasMore: offset + enriched.length < total });
});

/**
 * GET /api/v1/whatsapp/leads/:waId
 * Obtener un lead por wa_id
 */
export const getLeadByWaId = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const url = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}&select=*&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    res.status(response.status);
    throw new Error('Error al obtener lead');
  }
  const data = await response.json();
  res.json(data[0] || null);
});

/**
 * PATCH /api/v1/whatsapp/leads/:waId/modo-humano
 * Activar/desactivar modo humano
 */
export const toggleModoHumano = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { modo_humano } = req.body;

  const url = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      modo_humano: Boolean(modo_humano),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    res.status(response.status);
    throw new Error('Error al cambiar modo humano');
  }
  const data = await response.json();
  res.json({ success: true, data });
});

/**
 * GET /api/v1/whatsapp/leads-status
 * Devuelve un mapa de leads con estado_sofia para cruzar con HubSpot
 */
export const getLeadsStatus = asyncHandler(async (req, res) => {
  const url = `${SUPABASE_URL}/rest/v1/leads?select=wa_id,nombre,estado_sofia,updated_at&order=updated_at.desc&limit=200`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    const errorText = await response.text();
    res.status(response.status);
    throw new Error(`Error de Supabase: ${errorText}`);
  }
  const data = await response.json();
  res.json(data);
});

/**
 * PATCH /api/v1/whatsapp/leads/:waId/estado
 * Actualizar el estado_sofia de un lead
 */
export const updateLeadEstado = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { estado_sofia } = req.body;
  if (!waId || !estado_sofia) {
    res.status(400);
    throw new Error('wa_id y estado_sofia son requeridos');
  }
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}`;
  const response = await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      estado_sofia,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    res.status(response.status);
    throw new Error(`Error actualizando estado: ${err}`);
  }
  res.json({ success: true, estado_sofia });
});

/**
 * PATCH /api/v1/whatsapp/leads/:waId/notes
 * Actualizar notas y etiquetas de un lead
 */
export const updateLeadNotes = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { notas_admin, etiquetas } = req.body;

  const updateData = { updated_at: new Date().toISOString() };
  if (notas_admin !== undefined) updateData.notas_admin = notas_admin;
  if (etiquetas !== undefined) updateData.etiquetas = etiquetas; // array de strings

  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}`;
  const response = await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(updateData),
  });

  if (!response.ok) {
    const err = await response.text();
    res.status(response.status);
    throw new Error(`Error actualizando notas: ${err}`);
  }
  res.json({ success: true });
});

/**
 * GET /api/v1/whatsapp/leads/:waId/window-status
 * Verificar si la ventana de 24h está activa o expirada
 */
export const getWindowStatus = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const url = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}&select=historial_chat,nombre,updated_at&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    res.status(response.status);
    throw new Error('Error al obtener lead');
  }
  const data = await response.json();
  if (!data.length) {
    return res.json({ expired: true, lastUserMessage: null });
  }
  const updatedAt = data[0]?.updated_at || null;
  let historial = [];
  const raw = data[0]?.historial_chat;
  if (Array.isArray(raw)) {
    historial = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
  }
  const expired = isWindowExpired(historial, updatedAt);
  const lastUserMsg = [...historial].reverse().find(m => m.role === 'user');
  res.json({
    expired,
    lastUserMessage: lastUserMsg?.timestamp || updatedAt || null,
  });
});

/**
 * POST /api/v1/whatsapp/send
 * Enviar mensaje por WhatsApp y guardar en historial
 */
export const sendMessage = asyncHandler(async (req, res) => {
  const { wa_id, mensaje } = req.body;
  const file = req.file;

  if (!wa_id) {
    res.status(400);
    throw new Error('wa_id es requerido');
  }
  if (!mensaje && !file) {
    res.status(400);
    throw new Error('mensaje o archivo requerido');
  }

  // Upload file if exists
  let mediaUrl = null;
  let mediaType = null;
  let mimetype = null;
  let filename = null;
  let convertedOggBuffer = null; // Buffer OGG/Opus para subir a WhatsApp Media API
  let waAudioMediaId = null; // ID de WhatsApp Media API (audio subido directamente)

  if (file) {
    const isDoc = !!file.mimetype.match(/pdf|msword|officedocument|csv|text/i);
    const isAudio = !!file.mimetype.match(/audio|ogg|opus|mp3|mpeg|wav|webm|aac/i);

    // Limpiar MIME type: quitar parámetros como "; codecs=opus" que rompen el data URI
    const cleanMimetype = file.mimetype.split(';')[0].trim();
    let fileBuffer = `data:${cleanMimetype};base64,${file.buffer.toString('base64')}`;

    const uploadOptions = {
      folder: 'whatsapp_admin_media',
      resource_type: isDoc ? 'raw' : isAudio ? 'video' : 'auto',
    };

    // Si es un documento, subimos como 'raw' con extensión
    if (isDoc) {
      const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : 'pdf';
      uploadOptions.public_id = `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    } else if (isAudio) {
      // Conversión en 2 pasos: source → WAV limpio → OGG/Opus
      // Paso por WAV elimina metadata corrupta (causa #1 de "funciona en WA Web pero no en WA móvil")
      try {
        const ts = Date.now();
        const inExt = cleanMimetype.includes('mp4') ? 'mp4' : cleanMimetype.includes('ogg') ? 'ogg' : 'webm';
        const tmpIn = join(tmpdir(), `wa_audio_in_${ts}.${inExt}`);
        const tmpWav = join(tmpdir(), `wa_audio_clean_${ts}.wav`);
        const tmpOut = join(tmpdir(), `wa_audio_out_${ts}.ogg`);
        writeFileSync(tmpIn, file.buffer);

        // Paso 1: Normalizar a WAV limpio (strip metadata, solo audio, mono 48kHz)
        execSync(`${ffmpegPath} -hide_banner -loglevel error -nostdin -y -i "${tmpIn}" -vn -map_metadata -1 -ac 1 -ar 48000 -c:a pcm_s16le "${tmpWav}"`, { timeout: 15000 });

        // Paso 2: WAV limpio → OGG/Opus con params compatibles con WhatsApp móvil
        execSync(`${ffmpegPath} -hide_banner -loglevel error -nostdin -y -i "${tmpWav}" -c:a libopus -b:a 32k -ac 1 -ar 48000 -avoid_negative_ts make_zero "${tmpOut}"`, { timeout: 15000 });

        const oggBuffer = readFileSync(tmpOut);
        try { unlinkSync(tmpIn); unlinkSync(tmpWav); unlinkSync(tmpOut); } catch (_) {}
        console.log(`✅ Audio convertido (2-step): ${inExt}(${file.buffer.length}b) → wav → ogg/opus(${oggBuffer.length}b)`);

        // Guardar buffer para subir a WhatsApp Media API después
        convertedOggBuffer = oggBuffer;

        // Subir OGG/Opus como 'video' a Cloudinary (para historial/preview en admin)
        // IMPORTANTE: resource_type debe ser 'video' (no 'raw') para que Cloudinary
        // sirva el archivo con Content-Type: audio/ogg y el <audio> del navegador lo reproduzca.
        const oggBase64 = `data:audio/ogg;base64,${oggBuffer.toString('base64')}`;
        uploadOptions.resource_type = 'video';
        uploadOptions.public_id = `audio_${ts}_${Math.floor(Math.random() * 1000)}`;
        uploadOptions.format = 'ogg';
        fileBuffer = oggBase64;
      } catch (convErr) {
        console.error('❌ ffmpeg conversion failed:', convErr.message);
        console.error('❌ ffmpeg stderr:', convErr.stderr?.toString?.() || 'no stderr');
        console.error('❌ ffmpeg status:', convErr.status, 'signal:', convErr.signal);
        console.error('❌ Input: mimetype=', cleanMimetype, 'size=', file.buffer.length, 'originalname=', file.originalname);
        // Fallback: subir original como video (comportamiento anterior)
        uploadOptions.resource_type = 'video';
        uploadOptions.public_id = `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        uploadOptions.format = 'ogg';
      }
    }

    console.log(`📤 Subiendo archivo a Cloudinary: type=${cleanMimetype}, size=${file.buffer.length}, resource_type=${uploadOptions.resource_type}, isAudio=${isAudio}`);

    let result;
    try {
      result = await cloudinary.uploader.upload(fileBuffer, uploadOptions);
    } catch (uploadErr) {
      console.error('❌ Cloudinary upload error:', uploadErr.message || uploadErr);
      throw new Error(`Error al subir archivo a Cloudinary: ${uploadErr.message}`);
    }

    let finalUrl = result.secure_url;

    mediaUrl = finalUrl;
    mimetype = isAudio ? 'audio/ogg' : file.mimetype;
    filename = isAudio ? file.originalname.replace(/\.[^.]+$/, '.ogg') : file.originalname;
    mediaType = isAudio ? 'audio' : (isDoc ? 'document' : 'image');

    // Subir audio a WhatsApp Media API AHORA (antes del check de ventana)
    // para tener el media_id disponible tanto para envío directo como pendiente
    if (isAudio && convertedOggBuffer) {
      try {
        const boundary = `----WaBoundary${Date.now()}`;
        const parts = [];
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\naudio/ogg\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.ogg"\r\nContent-Type: audio/ogg; codecs=opus\r\n\r\n`));
        parts.push(convertedOggBuffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

        const mediaUploadRes = await fetch(
          `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/media`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${WA_TOKEN}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: Buffer.concat(parts),
          }
        );
        const mediaData = await mediaUploadRes.json();
        console.log('📤 WhatsApp Media API upload:', JSON.stringify(mediaData));

        if (mediaData.id) {
          waAudioMediaId = mediaData.id;
          console.log(`✅ Audio subido a WA Media API: id=${waAudioMediaId}`);
        } else {
          console.warn('⚠️ WA Media API falló:', JSON.stringify(mediaData));
        }
      } catch (mediaErr) {
        console.error('❌ WA Media API upload error:', mediaErr.message);
      }
    }
  }

  // 1. Obtener historial para verificar ventana de 24h ANTES de enviar
  const getUrlPre = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=historial_chat,wa_id,nombre,updated_at,atendido_por&limit=1`;
  const getResponsePre = await fetch(getUrlPre, { headers: supabaseHeaders() });
  let historialPre = [];
  let leadExistsPre = false;
  let leadNombre = '';
  let leadUpdatedAt = null;
  let leadAtendidoPor = null;
  if (getResponsePre.ok) {
    const leadDataPre = await getResponsePre.json();
    if (leadDataPre.length > 0) {
      leadExistsPre = true;
      leadNombre = leadDataPre[0]?.nombre || '';
      leadUpdatedAt = leadDataPre[0]?.updated_at || null;
      leadAtendidoPor = leadDataPre[0]?.atendido_por || null;
      if (leadDataPre[0]?.historial_chat) {
        const raw = leadDataPre[0].historial_chat;
        if (Array.isArray(raw)) {
          historialPre = raw;
        } else if (typeof raw === 'string' && raw.trim()) {
          try { historialPre = JSON.parse(raw.replace(/^=/, '')); } catch { historialPre = []; }
        }
      }
    }
  }

  const windowExpired = isWindowExpired(historialPre, leadUpdatedAt);
  let templateSent = false;

  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const cleanNumber = wa_id.replace(/\D/g, '');

  // ── VENTANA 24h EXPIRADA: enviar template + encolar mensaje pendiente ──
  if (windowExpired) {
    const firstName = (leadNombre || '').split(' ')[0] || 'cliente';
    const templatePayload = {
      messaging_product: 'whatsapp',
      to: cleanNumber,
      type: 'template',
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: firstName }],
          },
        ],
      },
    };

    const templateResponse = await fetch(waUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templatePayload),
    });

    if (!templateResponse.ok) {
      const templateErr = await templateResponse.text();
      console.error('WhatsApp Template error:', templateErr);
      res.status(templateResponse.status);
      throw new Error(`Error al enviar plantilla de seguimiento: ${templateErr}`);
    }

    templateSent = true;
    console.log('✅ Template de seguimiento enviado (ventana 24h expirada)');

    // NO intentar enviar el mensaje normal — la ventana solo se reabre
    // cuando el cliente RESPONDE al template.
    // Guardamos el mensaje como pendiente para enviarlo cuando el cliente responda.

    let historial = [...historialPre];
    let leadExists = leadExistsPre;
    const adminName = req.user?.name || 'Admin';

    if (!leadExists) {
      const createUrl = `${SUPABASE_URL}/rest/v1/leads`;
      await fetch(createUrl, {
        method: 'POST',
        headers: { ...supabaseHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          wa_id,
          nombre: `+${wa_id}`,
          estado_sofia: 'modo_humano',
          modo_humano: true,
          historial_chat: '[]',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    }

    // Registrar template en historial
    historial.push({
      role: 'assistant',
      content: `[TEMPLATE:seguimiento] Hola ${firstName}, somos el equipo de Tesipedia. Queremos darte seguimiento sobre tu proyecto academico. Si sigues interesado o tienes alguna duda, respondenos a este mensaje y con gusto te ayudamos.`,
      timestamp: new Date().toISOString(),
      isTemplate: true,
    });

    // Registrar mensaje del admin como PENDIENTE en historial
    const pendingMsg = {
      role: 'assistant',
      content: mensaje ? `[HUMANO:${adminName}] ${mensaje}` : `[HUMANO:${adminName}] (Archivo)`,
      timestamp: new Date().toISOString(),
      delivery_status: 'pending',
    };
    if (mediaUrl) {
      pendingMsg.mediaUrl = mediaUrl;
      pendingMsg.mimetype = mimetype;
      pendingMsg.filename = filename;
    }
    historial.push(pendingMsg);

    // Guardar historial + mensaje pendiente en campo separado
    const mensajePendiente = {
      mensaje: mensaje || '',
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      mimetype: mimetype || null,
      filename: filename || null,
      waAudioMediaId: waAudioMediaId || null,
      adminName: adminName,
      timestamp: new Date().toISOString(),
    };

    const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
    const patchBody = {
      historial_chat: JSON.stringify(historial),
      modo_humano: true,
      mensaje_pendiente: JSON.stringify(mensajePendiente),
      updated_at: new Date().toISOString(),
      ultimo_mensaje_preview: buildLastMessagePreview(historial),
    };
    // Solo asignar dueño si el lead no tiene uno
    if (!leadAtendidoPor) {
      patchBody.atendido_por = adminName.toLowerCase();
    }
    const patchResp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify(patchBody),
    });

    if (!patchResp.ok) {
      const patchErr = await patchResp.text();
      console.error('❌ Error guardando historial (template) en Supabase:', patchResp.status, patchErr);
    } else {
      console.log(`✅ Template + mensaje pendiente guardado en Supabase para ${wa_id}`);
    }

    return res.json({
      success: true,
      message_id: null,
      delivery_status: 'pending',
      templateSent: true,
      windowExpired: true,
      pendingMessage: true,
    });
  }

  // ── VENTANA ABIERTA: enviar mensaje normal directamente ──
  const payload = {
    messaging_product: 'whatsapp',
    to: cleanNumber,
  };

  if (mediaUrl) {
    payload.type = mediaType;

    // Audio: usar media_id de WA Media API (subido arriba), fallback a link
    if (mediaType === 'audio') {
      if (waAudioMediaId) {
        payload.audio = { id: waAudioMediaId };
        console.log(`🔊 Enviando audio con WA media_id: ${waAudioMediaId}`);
      } else {
        payload.audio = { link: mediaUrl };
        console.log(`🔊 Enviando audio con Cloudinary link (fallback): ${mediaUrl}`);
      }
    } else {
      payload[mediaType] = { link: mediaUrl };
      if (mensaje) payload[mediaType].caption = mensaje;
      if (mediaType === 'document' && filename) payload.document.filename = filename;
    }
  } else {
    payload.type = 'text';
    payload.text = { body: mensaje };
  }

  const waResponse = await fetch(waUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let waResult;
  if (!waResponse.ok) {
    const errorData = await waResponse.text();
    console.error('WhatsApp API error:', errorData);
    res.status(waResponse.status);
    throw new Error(`Error al enviar WhatsApp: ${errorData}`);
  } else {
    waResult = await waResponse.json();
  }

  // 2. Usar historial ya obtenido arriba (evitar doble fetch)
  let historial = [...historialPre];
  let leadExists = leadExistsPre;

  // Si no existe lead para este wa_id, crearlo
  if (!leadExists) {
    const createUrl = `${SUPABASE_URL}/rest/v1/leads`;
    await fetch(createUrl, {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        wa_id,
        nombre: `+${wa_id}`,
        estado_sofia: 'modo_humano',
        modo_humano: true,
        historial_chat: '[]',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // 3. Agregar mensaje del admin al historial
  const adminName = req.user?.name || 'Admin';
  const waMessageId = waResult.messages?.[0]?.id || null;
  const newMsg = {
    role: 'assistant',
    content: mensaje ? `[HUMANO:${adminName}] ${mensaje}` : `[HUMANO:${adminName}] (Archivo)`,
    timestamp: new Date().toISOString(),
    wa_message_id: waMessageId,
    delivery_status: 'sent',
  };

  if (mediaUrl) {
    newMsg.mediaUrl = mediaUrl;
    newMsg.mimetype = mimetype;
    newMsg.filename = filename;
  }

  historial.push(newMsg);

  // 4. Guardar historial actualizado en Supabase + quién atendió
  //    Auto-activar modo_humano para detener a Sofía bot cuando un admin envía mensaje
  //    Solo asignar dueño si el lead no tiene uno (primer agente = dueño permanente)
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
  const patchBody = {
    historial_chat: JSON.stringify(historial),
    modo_humano: true,
    updated_at: new Date().toISOString(),
    ultimo_mensaje_preview: buildLastMessagePreview(historial),
  };
  if (!leadAtendidoPor) {
    patchBody.atendido_por = adminName.toLowerCase();
  }
  const patchResp = await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(patchBody),
  });

  if (!patchResp.ok) {
    const patchErr = await patchResp.text();
    console.error('❌ Error guardando historial en Supabase:', patchResp.status, patchErr);
    // El mensaje ya se envió por WA, así que no lanzamos error — pero avisamos al frontend
    return res.json({
      success: true,
      message_id: waMessageId,
      delivery_status: 'sent',
      templateSent: false,
      windowExpired: false,
      warning: 'Mensaje enviado por WhatsApp pero hubo error al guardar en historial',
    });
  }

  console.log(`✅ Mensaje guardado en Supabase para ${wa_id} (historial: ${historial.length} msgs)`);

  res.json({
    success: true,
    message_id: waMessageId,
    delivery_status: 'sent',
    templateSent: false,
    windowExpired: false,
  });
});

/**
 * POST /api/v1/whatsapp/send-template
 * Enviar SOLO la plantilla de seguimiento para revivir una conversación
 * (sin mensaje de texto adicional)
 */
export const sendTemplate = asyncHandler(async (req, res) => {
  const { wa_id } = req.body;

  if (!wa_id) {
    res.status(400);
    throw new Error('wa_id es requerido');
  }

  // 1. Obtener lead para nombre y historial
  const getUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=historial_chat,nombre,atendido_por&limit=1`;
  const getResponse = await fetch(getUrl, { headers: supabaseHeaders() });
  let historial = [];
  let leadNombre = '';
  let templateLeadAtendidoPor = null;

  if (getResponse.ok) {
    const leadData = await getResponse.json();
    if (leadData.length > 0) {
      leadNombre = leadData[0]?.nombre || '';
      templateLeadAtendidoPor = leadData[0]?.atendido_por || null;
      const raw = leadData[0]?.historial_chat;
      if (Array.isArray(raw)) {
        historial = raw;
      } else if (typeof raw === 'string' && raw.trim()) {
        try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
      }
    }
  }

  // 2. Enviar la plantilla
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const cleanNumber = wa_id.replace(/\D/g, '');
  const firstName = (leadNombre || '').split(' ')[0] || 'cliente';

  const templatePayload = {
    messaging_product: 'whatsapp',
    to: cleanNumber,
    type: 'template',
    template: {
      name: WA_TEMPLATE_NAME,
      language: { code: WA_TEMPLATE_LANG },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: firstName }],
        },
      ],
    },
  };

  const templateResponse = await fetch(waUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(templatePayload),
  });

  if (!templateResponse.ok) {
    const templateErr = await templateResponse.text();
    console.error('WhatsApp Template error:', templateErr);
    res.status(templateResponse.status);
    throw new Error(`Error al enviar plantilla: ${templateErr}`);
  }

  const waResult = await templateResponse.json();
  console.log('✅ Template de seguimiento enviado manualmente');

  // 3. Registrar en historial
  historial.push({
    role: 'assistant',
    content: `[TEMPLATE:seguimiento] Hola ${firstName}, somos el equipo de Tesipedia. Queremos darte seguimiento sobre tu proyecto academico. Si sigues interesado o tienes alguna duda, respondenos a este mensaje y con gusto te ayudamos.`,
    timestamp: new Date().toISOString(),
    isTemplate: true,
  });

  // 4. Guardar historial actualizado + auto-activar modo_humano
  //    Solo asignar dueño si el lead no tiene uno
  const adminName = req.user?.name || 'Admin';
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
  const templatePatchBody = {
    historial_chat: JSON.stringify(historial),
    modo_humano: true,
    updated_at: new Date().toISOString(),
  };
  if (!templateLeadAtendidoPor) {
    templatePatchBody.atendido_por = adminName.toLowerCase();
  }
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(templatePatchBody),
  });

  res.json({
    success: true,
    message_id: waResult.messages?.[0]?.id || null,
    templateSent: true,
  });
});

/**
 * PATCH /api/v1/whatsapp/leads/:waId/claim
 * Reclamar un lead — solo si no tiene dueño.
 * Si ya tiene dueño, devuelve error con el nombre del dueño actual.
 */
export const claimLead = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { atendido_por, force } = req.body;
  const isSuperAdmin = req.user?.role === 'superadmin';

  if (!waId) {
    res.status(400);
    throw new Error('wa_id es requerido');
  }

  // 1. Verificar dueño actual
  const getUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}&select=atendido_por&limit=1`;
  const getResp = await fetch(getUrl, { headers: supabaseHeaders() });
  if (!getResp.ok) {
    res.status(500);
    throw new Error('Error al consultar lead');
  }
  const leadData = await getResp.json();
  if (!leadData.length) {
    res.status(404);
    throw new Error('Lead no encontrado');
  }

  const currentOwner = leadData[0]?.atendido_por;

  // Si ya tiene dueño y NO es superadmin, rechazar
  if (currentOwner && currentOwner.trim() && !isSuperAdmin) {
    return res.json({
      success: false,
      claimed: false,
      current_owner: currentOwner,
      message: `Lead ya pertenece a ${currentOwner}`,
    });
  }

  // 2. Asignar dueño (SuperAdmin puede reasignar o desasignar)
  const newOwner = (atendido_por || '').toLowerCase().trim();
  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}`;
  const patchResp = await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      atendido_por: newOwner,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!patchResp.ok) {
    res.status(500);
    throw new Error('Error al reclamar lead');
  }

  res.json({
    success: true,
    claimed: true,
    atendido_por: newOwner,
    reassigned: !!currentOwner,
  });
});

/**
 * POST /api/v1/whatsapp/reengagement
 * Sofia envia mensajes personalizados a leads estancados segun su estado.
 * Body opcional: { hours: 24 } — ventana de tiempo (default 24h)
 */
export const sendReengagement = asyncHandler(async (req, res) => {
  const ADMIN_IDS = ['5215583352096', '525561757123', '525512478395', '5215541004180', '5215561757123'];
  const hours = Number(req.body?.hours) || 24;

  // 1. Obtener leads en bienvenida, calificando o cotizando de las ultimas N horas
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  // Optimizado: NO traer historial_chat en la query masiva — se obtiene individualmente al enviar
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=gte.${since}&estado_sofia=in.(bienvenida,calificando,cotizando)&modo_humano=eq.false&bloqueado=neq.true&select=wa_id,nombre,estado_sofia,updated_at,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    res.status(500);
    throw new Error('Error al consultar leads en Supabase');
  }
  const allLeads = await response.json();

  // 2. Filtrar admins y leads que ya pagaron
  const stuckLeads = allLeads.filter(l => !ADMIN_IDS.includes(l.wa_id));

  if (stuckLeads.length === 0) {
    return res.json({ success: true, sent: 0, failed: 0, total: 0, results: [], message: 'No hay leads para enviar recordatorio' });
  }

  // 3. Enviar mensaje de Sofia a cada lead (respetando límite de 2 intentos sin respuesta)
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const results = [];

  for (const lead of stuckLeads) {
    // ── Verificar historial: si ya se mandaron 2+ recordatorios sin respuesta, saltar ──
    let historial = [];
    try {
      const histResp = await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}&select=historial_chat&limit=1`, { headers: supabaseHeaders() });
      if (histResp.ok) {
        const histData = await histResp.json();
        const raw = histData[0]?.historial_chat;
        if (Array.isArray(raw)) historial = raw;
        else if (typeof raw === 'string' && raw.trim()) {
          try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
        }
      }
    } catch { /* continuar */ }

    let consecutiveReminders = 0;
    for (let i = historial.length - 1; i >= 0; i--) {
      const m = historial[i];
      if (m.role === 'user') break;
      if (m.isReengagement || m.isTemplate) consecutiveReminders++;
    }

    if (consecutiveReminders >= 2) {
      // Marcar como descartado para no evaluarlo mas
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ estado_sofia: 'descartado' }),
        });
      } catch { /* no critical */ }
      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, estado: lead.estado_sofia, success: false, error: 'Descartado: 2+ recordatorios sin respuesta' });
      continue;
    }

    const cleanNumber = lead.wa_id.replace(/\D/g, '');
    const msg = buildSofiaContextualMessage(lead);

    try {
      const waResp = await fetch(waUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: cleanNumber, type: 'text', text: { body: msg } }),
      });
      const waData = await waResp.json();
      const success = !!waData.messages;

      if (success) {
        historial.push({
          role: 'assistant',
          content: msg,
          timestamp: new Date().toISOString(),
          isReengagement: true,
        });

        await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({
            historial_chat: JSON.stringify(historial),
            updated_at: new Date().toISOString(),
          }),
        });
      }

      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, estado: lead.estado_sofia, success, error: waData.error?.message || null });
    } catch (e) {
      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, estado: lead.estado_sofia, success: false, error: e.message });
    }
  }

  const sent = results.filter(r => r.success).length;
  const skippedR = results.filter(r => r.error?.includes('Descartado')).length;
  const failed = results.filter(r => !r.success && !r.error?.includes('Descartado')).length;
  console.log(`📣 Sofia Recordatorio: ${sent} enviados, ${failed} fallidos, ${skippedR} descartados de ${stuckLeads.length} leads (ventana: ${hours}h)`);

  res.json({ success: true, sent, failed, skipped: skippedR, total: stuckLeads.length, results });
});


/* ═══════════════════════════════════════════════════════════════════
 *  AUTO-REMINDER — Sofia automatica
 *  Corre en background cada N minutos, detecta leads estancados
 *  y les manda recordatorio personalizado.
 *  Controlable via API desde el panel de admin.
 * ═══════════════════════════════════════════════════════════════════ */

// Estado en memoria — arranca activo cada 6h por defecto
const autoReminder = {
  active: false,            // se activa abajo con startAutoReminder()
  intervalMinutes: 360,     // cada 6 horas
  staleMinutes: 360,        // leads sin actividad por mas de 6 horas
  maxPerRun: 50,            // maximo de mensajes por ejecucion
  lastRun: null,
  lastResult: null,
  _timer: null,
};

// Reutiliza la funcion contextual buildSofiaContextualMessage definida arriba

// Funcion interna que ejecuta el ciclo de recordatorios
async function runAutoReminder() {
  const ADMIN_IDS = ['5215583352096', '525561757123', '525512478395', '5215541004180', '5215561757123'];
  const since = new Date(Date.now() - autoReminder.staleMinutes * 60 * 1000).toISOString();

  try {
    // Leads que NO se han actualizado en los ultimos N minutos
    // Optimizado: NO traer historial_chat en query masiva — se obtiene individualmente
    const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${since}&estado_sofia=in.(bienvenida,calificando,cotizando)&modo_humano=eq.false&select=wa_id,nombre,estado_sofia,updated_at,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega&order=updated_at.asc&limit=${autoReminder.maxPerRun}`;
    const resp = await fetch(url, { headers: supabaseHeaders() });
    if (!resp.ok) {
      console.error('Auto-reminder: error Supabase', resp.status);
      autoReminder.lastResult = { error: 'Supabase error ' + resp.status, time: new Date().toISOString() };
      return;
    }
    const allLeads = await resp.json();
    const leads = allLeads.filter(l => !ADMIN_IDS.includes(l.wa_id));

    if (leads.length === 0) {
      autoReminder.lastRun = new Date().toISOString();
      autoReminder.lastResult = { sent: 0, failed: 0, total: 0, skipped: 0, time: new Date().toISOString() };
      console.log('🤖 Auto-reminder: 0 leads estancados');
      return;
    }

    const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
    let sent = 0, failed = 0, skipped = 0;

    for (const lead of leads) {
      // ── Verificar historial: si ya se mandaron 2+ recordatorios sin respuesta, saltar ──
      let historial = [];
      try {
        const histResp = await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}&select=historial_chat&limit=1`, { headers: supabaseHeaders() });
        if (histResp.ok) {
          const histData = await histResp.json();
          const raw = histData[0]?.historial_chat;
          if (Array.isArray(raw)) historial = raw;
          else if (typeof raw === 'string' && raw.trim()) {
            try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
          }
        }
      } catch { /* continuar sin historial */ }

      // Contar recordatorios consecutivos al final del chat (sin respuesta del cliente en medio)
      let consecutiveReminders = 0;
      for (let i = historial.length - 1; i >= 0; i--) {
        const m = historial[i];
        if (m.role === 'user') break; // el cliente respondió, dejar de contar
        if (m.isReengagement || m.isTemplate) consecutiveReminders++;
      }

      if (consecutiveReminders >= 2) {
        skipped++;
        console.log(`🤖 Auto-reminder: SKIP ${lead.nombre || lead.wa_id} — ya tiene ${consecutiveReminders} recordatorios sin respuesta`);
        // Marcar como descartado automáticamente para no volverlo a evaluar
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({ estado_sofia: 'descartado' }),
          });
        } catch { /* no critical */ }
        continue;
      }

      const cleanNumber = lead.wa_id.replace(/\D/g, '');
      const msg = buildSofiaContextualMessage(lead);

      try {
        const waResp = await fetch(waUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: cleanNumber, type: 'text', text: { body: msg } }),
        });
        const waData = await waResp.json();

        if (waData.messages) {
          sent++;

          // Reusar el historial ya obtenido arriba (antes del check de 2 intentos)
          historial.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString(), isReengagement: true });

          await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({ historial_chat: JSON.stringify(historial), updated_at: new Date().toISOString() }),
          });
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    autoReminder.lastRun = new Date().toISOString();
    autoReminder.lastResult = { sent, failed, skipped, total: leads.length, time: new Date().toISOString() };
    console.log(`🤖 Auto-reminder: ${sent} enviados, ${failed} fallidos, ${skipped} descartados de ${leads.length} leads`);
  } catch (e) {
    console.error('Auto-reminder error:', e.message);
    autoReminder.lastResult = { error: e.message, time: new Date().toISOString() };
  }
}

function startAutoReminder() {
  if (autoReminder._timer) clearInterval(autoReminder._timer);
  autoReminder.active = true;
  autoReminder._timer = setInterval(runAutoReminder, autoReminder.intervalMinutes * 60 * 1000);
  // Ejecutar inmediatamente la primera vez
  runAutoReminder();
  console.log(`🤖 Auto-reminder ACTIVADO — cada ${autoReminder.intervalMinutes} min, leads >  ${autoReminder.staleMinutes} min sin actividad`);
}

function stopAutoReminder() {
  if (autoReminder._timer) clearInterval(autoReminder._timer);
  autoReminder._timer = null;
  autoReminder.active = false;
  console.log('🤖 Auto-reminder DESACTIVADO');
}

/**
 * GET /api/v1/whatsapp/auto-reminder
 * Obtener estado y config del auto-reminder
 */
export const getAutoReminderStatus = asyncHandler(async (req, res) => {
  res.json({
    active: autoReminder.active,
    intervalMinutes: autoReminder.intervalMinutes,
    staleMinutes: autoReminder.staleMinutes,
    maxPerRun: autoReminder.maxPerRun,
    lastRun: autoReminder.lastRun,
    lastResult: autoReminder.lastResult,
  });
});

/**
 * POST /api/v1/whatsapp/auto-reminder
 * Activar/desactivar y configurar el auto-reminder
 * Body: { active, intervalMinutes, staleMinutes, maxPerRun }
 */
export const configAutoReminder = asyncHandler(async (req, res) => {
  const { active, intervalMinutes, staleMinutes, maxPerRun } = req.body;

  if (intervalMinutes !== undefined) autoReminder.intervalMinutes = Math.max(5, Number(intervalMinutes) || 30);
  if (staleMinutes !== undefined) autoReminder.staleMinutes = Math.max(5, Number(staleMinutes) || 30);
  if (maxPerRun !== undefined) autoReminder.maxPerRun = Math.max(1, Math.min(100, Number(maxPerRun) || 20));

  if (active === true) {
    startAutoReminder();
  } else if (active === false) {
    stopAutoReminder();
  } else if (autoReminder.active) {
    // Si solo cambiaron params, reiniciar con nuevos valores
    startAutoReminder();
  }

  res.json({
    success: true,
    active: autoReminder.active,
    intervalMinutes: autoReminder.intervalMinutes,
    staleMinutes: autoReminder.staleMinutes,
    maxPerRun: autoReminder.maxPerRun,
  });
});

// ═══════════════════════════════════════════════════════
// BLOQUEO / DESBLOQUEO DE CONTACTOS
// ═══════════════════════════════════════════════════════

/**
 * PATCH /api/v1/whatsapp/leads/:waId/block
 * Bloquear o desbloquear un contacto.
 * Body: { blocked: true/false }
 * Cuando blocked=true:
 *  - Se marca bloqueado=true en Supabase
 *  - Se desactiva modo_humano y Sofia (no más mensajes automáticos)
 * Cuando blocked=false:
 *  - Se desbloquea el contacto
 */
export const toggleBlockLead = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { blocked } = req.body;

  if (!waId) {
    res.status(400);
    throw new Error('waId es requerido');
  }
  if (typeof blocked !== 'boolean') {
    res.status(400);
    throw new Error('blocked (boolean) es requerido');
  }

  const patchUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}`;
  const patchBody = {
    bloqueado: blocked,
    updated_at: new Date().toISOString(),
  };

  // Si se bloquea, también desactivar interacciones
  if (blocked) {
    patchBody.modo_humano = true; // Detener Sofia
  }

  const patchResponse = await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(patchBody),
  });

  if (!patchResponse.ok) {
    const err = await patchResponse.text();
    console.error('Error al actualizar bloqueo en Supabase:', err);
    res.status(500);
    throw new Error(`Error al ${blocked ? 'bloquear' : 'desbloquear'} contacto`);
  }

  res.json({
    success: true,
    blocked,
    message: blocked ? 'Contacto bloqueado exitosamente' : 'Contacto desbloqueado exitosamente',
  });
});

/* ═══════════════════════════════════════════════════════════════════
 *  LEAD REVIVAL — Sofia revive leads fríos/descartados
 *  Mensajes personalizados según estado_sofia + días de inactividad.
 *  Dos modos: endpoint manual + cron job automático.
 *  Rangos: 3d (suave), 7d (beneficio), 14d (oferta), 30d+ (último intento)
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Calcula los días de inactividad de un lead
 */
function getDaysInactive(lead) {
  const lastActivity = new Date(lead.updated_at || lead.created_at);
  return Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Clasifica un lead en su rango de revival: 3, 7, 14 o 30 días
 * Retorna null si no cae en ningún rango activo
 */
function getRevivalTier(daysInactive) {
  if (daysInactive >= 30) return 30;
  if (daysInactive >= 14) return 14;
  if (daysInactive >= 7) return 7;
  if (daysInactive >= 3) return 3;
  return null; // Menos de 3 días — no aplica revival
}

/**
 * Genera un mensaje de revival personalizado según:
 * - estado_sofia del lead (bienvenida, calificando, cotizando, descartado, modo_humano)
 * - rango de días de inactividad (3, 7, 14, 30)
 * - datos que ya tenga el lead (nombre, tipo_servicio, tema, etc.)
 */
function buildRevivalMessage(lead, tier) {
  const nombre = (lead.nombre || '').split(' ')[0];
  const saludo = nombre ? `Hola ${nombre}` : 'Hola';
  const estado = lead.estado_sofia || 'bienvenida';

  // ── Info del lead para personalizar ──
  const tieneServicio = !!lead.tipo_servicio;
  const tieneTema = !!lead.tema;
  const tieneProyecto = !!lead.tipo_proyecto;
  const servicioLabel = { servicio_1: 'redaccion completa', servicio_2: 'correccion de estilo', servicio_3: 'asesoria' }[lead.tipo_servicio] || '';
  const proyectoLabel = (lead.tipo_proyecto || '').toLowerCase();

  // ═══════════════════════════════
  // TIER 3 DÍAS — Mensaje suave, retomar conversación
  // ═══════════════════════════════
  if (tier === 3) {
    if (estado === 'bienvenida') {
      return `${saludo}, soy Sofia de Tesipedia! 😊 Hace unos dias nos escribiste y me encantaria poder ayudarte. Si tienes algun proyecto academico pendiente (tesis, tesina, ensayo...) estoy aqui para orientarte sin compromiso. Cuentame en que puedo ayudarte!`;
    }
    if (estado === 'calificando') {
      if (tieneTema) {
        return `${saludo}, soy Sofia de Tesipedia! Estabamos platicando sobre tu proyecto de "${lead.tema}" y nos quedamos a medias. Me encantaria retomar donde nos quedamos para darte una cotizacion. Te parece si continuamos?`;
      }
      if (tieneServicio) {
        return `${saludo}, soy Sofia de Tesipedia! Nos quedamos platicando sobre tu ${servicioLabel} y me faltan unos datos para cotizarte. Quieres que retomemos? Solo me tomara un par de minutos completar tu informacion.`;
      }
      return `${saludo}, soy Sofia de Tesipedia! Estabamos en medio de platicar sobre tu proyecto academico. Quieres que retomemos donde nos quedamos? Estoy aqui para ayudarte.`;
    }
    if (estado === 'cotizando') {
      return `${saludo}, soy Sofia de Tesipedia! Tu cotizacion${tieneTema ? ` para "${lead.tema}"` : ''} esta lista. Solo necesito que me confirmes para enviartela. Quieres que te la mande?`;
    }
    if (estado === 'descartado') {
      return `${saludo}, soy Sofia de Tesipedia! 😊 Se que paso un tiempo desde que platicamos, pero queria saber si tu proyecto academico${tieneTema ? ` sobre "${lead.tema}"` : ''} sigue pendiente. Si necesitas ayuda, aqui estoy sin compromiso!`;
    }
    // modo_humano u otros estados
    return `${saludo}, te escribe Sofia de Tesipedia! Queria dar seguimiento a nuestra platica anterior. Sigues necesitando apoyo con tu proyecto academico? Estoy aqui para ayudarte.`;
  }

  // Nota de opt-out para tiers 7+
  const OPT_OUT = '\n\n_Si ya no deseas recibir mas mensajes, escribe *STOP* y no te contactaremos de nuevo._';

  // ═══════════════════════════════
  // TIER 7 DÍAS — Mencionar beneficio, crear urgencia suave
  // ═══════════════════════════════
  if (tier === 7) {
    if (estado === 'bienvenida') {
      return `${saludo}, soy Sofia de Tesipedia! Ha pasado una semana desde que nos contactaste. Entiendo que a veces la agenda se complica, pero tu proyecto academico es importante. Tenemos asesoria gratuita inicial para que sepas exactamente como podemos ayudarte. Te interesa?`;
    }
    if (estado === 'calificando') {
      return `${saludo}, soy Sofia de Tesipedia! Ya tenemos parte de tu informacion${tieneProyecto ? ` sobre tu ${proyectoLabel}` : ''} y estamos a pocos pasos de darte una cotizacion personalizada. Esta semana tenemos buena disponibilidad para nuevos proyectos. Quieres que terminemos de cotizarte?`;
    }
    if (estado === 'cotizando') {
      return `${saludo}, soy Sofia de Tesipedia! Tu cotizacion${tieneTema ? ` para "${lead.tema}"` : ''} sigue disponible y lista. Recuerda que los precios pueden variar conforme se acerquen las fechas de entrega. Quieres que te la envie ahora para que la revises?`;
    }
    if (estado === 'descartado') {
      return `${saludo}, soy Sofia de Tesipedia! Queria escribirte porque muchos estudiantes regresan justo en esta epoca. Si tu ${tieneProyecto ? proyectoLabel : 'proyecto academico'}${tieneTema ? ` sobre "${lead.tema}"` : ''} sigue pendiente, tenemos asesoria inicial sin costo para retomar. Puedo orientarte?`;
    }
    return `${saludo}, te escribe Sofia de Tesipedia! Ha pasado una semana y queria saber si puedo ayudarte con algo. Tenemos disponibilidad esta semana y asesoria sin compromiso. Me cuentas?` + OPT_OUT;
  }

  // ═══════════════════════════════
  // TIER 14 DÍAS — Oferta especial, más directo
  // ═══════════════════════════════
  if (tier === 14) {
    if (estado === 'bienvenida') {
      return `${saludo}, soy Sofia de Tesipedia! Han pasado dos semanas y se que el semestre avanza rapido. No dejes tu proyecto academico para el final: tenemos un 10% de descuento especial para quienes retoman su cotizacion esta semana. Te interesa saber mas?` + OPT_OUT;
    }
    if (estado === 'calificando') {
      return `${saludo}, soy Sofia de Tesipedia! Tu ${tieneProyecto ? proyectoLabel : 'proyecto'}${tieneTema ? ` sobre "${lead.tema}"` : ''} sigue en nuestro sistema y no quiero que pierdas la oportunidad. Esta quincena tenemos un descuento del 10% para retomar proyectos. Quieres que completemos tu cotizacion?` + OPT_OUT;
    }
    if (estado === 'cotizando') {
      return `${saludo}, soy Sofia de Tesipedia! Tu cotizacion${tieneTema ? ` para "${lead.tema}"` : ''} ya tiene dos semanas esperandote. Para motivarte a decidir, tenemos un 10% de descuento si confirmas esta semana. Te la reenvio con el precio especial?` + OPT_OUT;
    }
    if (estado === 'descartado') {
      return `${saludo}, soy Sofia de Tesipedia! Se que ha pasado tiempo, pero queria ofrecerte algo especial: 10% de descuento en cualquiera de nuestros servicios si retomas tu proyecto esta semana. ${tieneTema ? `Tu tema "${lead.tema}" suena muy interesante y me encantaria ayudarte.` : 'Me encantaria ayudarte con tu proyecto academico.'} Que dices?` + OPT_OUT;
    }
    return `${saludo}, te escribe Sofia de Tesipedia! Ya pasaron dos semanas y tenemos una promocion especial: 10% de descuento para proyectos que se retomen esta semana. Te interesa?` + OPT_OUT;
  }

  // ═══════════════════════════════
  // TIER 30 DÍAS — Último intento, "te extrañamos"
  // ═══════════════════════════════
  if (tier >= 30) {
    if (estado === 'bienvenida' || estado === 'descartado') {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Ha pasado un buen tiempo y queria escribirte por ultima vez. Si en algun momento necesitas apoyo con tu tesis o proyecto academico, aqui seguimos. Nuestro equipo tiene experiencia en mas de 500 proyectos y nos encantaria ayudarte. Solo responde este mensaje y retomamos. Exito en todo!` + OPT_OUT;
    }
    if (estado === 'calificando') {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Ya paso un mes y tu ${tieneProyecto ? proyectoLabel : 'proyecto'}${tieneTema ? ` sobre "${lead.tema}"` : ''} sigue registrado con nosotros. Este es mi ultimo mensaje, pero si decides retomar, solo responde y te atendemos de inmediato. Nuestro equipo ha ayudado a mas de 500 estudiantes a graduarse. Mucho exito!` + OPT_OUT;
    }
    if (estado === 'cotizando') {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Tu cotizacion${tieneTema ? ` para "${lead.tema}"` : ''} vencio, pero puedo generarte una nueva al instante si la necesitas. Este es mi ultimo seguimiento: si decides avanzar con tu proyecto, solo responde y retomamos donde nos quedamos. Te deseo mucho exito!` + OPT_OUT;
    }
    return `${saludo}, te escribe Sofia de Tesipedia! 🎓 Ha pasado bastante tiempo. Este es mi ultimo mensaje de seguimiento, pero si algun dia necesitas apoyo academico, aqui estaremos. Solo responde y te atendemos. Mucho exito en todo!` + OPT_OUT;
  }

  // Fallback (no debería llegar aquí)
  return `${saludo}, soy Sofia de Tesipedia! Queria saber si sigues interesado en recibir apoyo con tu proyecto academico. Estamos aqui para ayudarte!`;
}

// ── Estado en memoria del revival automático ──
const autoRevival = {
  active: false,
  intervalHours: 24,       // Corre cada 24 horas
  maxPerRun: 30,            // Max leads por ejecución
  lastRun: null,
  lastResult: null,
  _timer: null,
};

/**
 * Lógica core de revival: busca leads fríos y les envía mensaje según tier
 * Reutilizable por endpoint manual y cron job
 * @param {Object} options - { maxPerRun, dryRun, tiers }
 * @returns {Object} resultados del revival
 */
async function runRevivalCore(options = {}) {
  const ADMIN_IDS = ['5215583352096', '525561757123', '525512478395', '5215541004180', '5215561757123'];
  const maxPerRun = options.maxPerRun || autoRevival.maxPerRun;
  const dryRun = options.dryRun || false;
  const allowedTiers = options.tiers || [3, 7, 14, 30];

  // Buscar TODOS los leads no convertidos (excepto bloqueados)
  // Incluimos todos los estados: bienvenida, calificando, cotizando, descartado, modo_humano
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // Excluir bloqueados y leads que ya pagaron/compraron
  const PAID_STATES = 'pagado,cliente_acepto,esperando_aprobacion';
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${threeDaysAgo}&bloqueado=neq.true&estado_sofia=not.in.(${PAID_STATES})&select=wa_id,nombre,estado_sofia,updated_at,created_at,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega,modo_humano&order=updated_at.asc&limit=500`;

  const resp = await fetch(url, { headers: supabaseHeaders() });
  if (!resp.ok) {
    throw new Error(`Supabase error ${resp.status}`);
  }

  const allLeads = await resp.json();
  // Filtrar admin IDs
  const leads = allLeads.filter(l => !ADMIN_IDS.includes(l.wa_id));

  const results = [];
  const tierStats = { 3: 0, 7: 0, 14: 0, 30: 0 };
  let sent = 0, failed = 0, skipped = 0;

  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;

  for (const lead of leads) {
    if (sent >= maxPerRun) break;

    const daysInactive = getDaysInactive(lead);
    const tier = getRevivalTier(daysInactive);

    // No cae en ningún rango o el tier no está permitido
    if (!tier || !allowedTiers.includes(tier)) {
      continue;
    }

    // ── Obtener historial para verificar que no le hayamos mandado revival recientemente ──
    let historial = [];
    try {
      const histResp = await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}&select=historial_chat&limit=1`, { headers: supabaseHeaders() });
      if (histResp.ok) {
        const histData = await histResp.json();
        const raw = histData[0]?.historial_chat;
        if (Array.isArray(raw)) historial = raw;
        else if (typeof raw === 'string' && raw.trim()) {
          try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
        }
      }
    } catch { /* continuar sin historial */ }

    // ── Verificar: no enviar si ya le mandamos un revival en este mismo tier ──
    // Buscar si el último mensaje de revival tiene el mismo tier
    const lastRevival = [...historial].reverse().find(m => m.isRevival);
    if (lastRevival && lastRevival.revivalTier === tier) {
      skipped++;
      results.push({
        wa_id: lead.wa_id,
        nombre: lead.nombre,
        estado: lead.estado_sofia,
        daysInactive,
        tier,
        success: false,
        reason: `Ya recibio revival tier ${tier}`,
      });
      continue;
    }

    // ── Verificar: si el cliente respondió después del último revival, no saltamos ──
    // (puede recibir el siguiente tier si aplica)

    // ── Verificar: no enviar si tiene 3+ revival messages sin respuesta ──
    let consecutiveRevivals = 0;
    for (let i = historial.length - 1; i >= 0; i--) {
      const m = historial[i];
      if (m.role === 'user') break;
      if (m.isRevival || m.isReengagement || m.isTemplate) consecutiveRevivals++;
    }
    if (consecutiveRevivals >= 4) {
      skipped++;
      results.push({
        wa_id: lead.wa_id,
        nombre: lead.nombre,
        estado: lead.estado_sofia,
        daysInactive,
        tier,
        success: false,
        reason: `Maximo de revivals alcanzado (${consecutiveRevivals} sin respuesta)`,
      });
      continue;
    }

    const msg = buildRevivalMessage(lead, tier);

    if (dryRun) {
      sent++;
      tierStats[tier]++;
      results.push({
        wa_id: lead.wa_id,
        nombre: lead.nombre,
        estado: lead.estado_sofia,
        daysInactive,
        tier,
        success: true,
        dryRun: true,
        message: msg,
      });
      continue;
    }

    // ── SIEMPRE enviar template aprobado por Meta (ventana expirada para leads fríos) ──
    // El mensaje personalizado de Sofia se guarda como mensaje_pendiente
    // y se enviará cuando el lead responda a la plantilla.
    const cleanNumber = lead.wa_id.replace(/\D/g, '');
    const firstName = (lead.nombre || 'amigo').split(' ')[0];

    try {
      const tplBody = {
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'template',
        template: {
          name: WA_TEMPLATE_NAME,
          language: { code: WA_TEMPLATE_LANG },
          components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }],
        },
      };
      const tplResp = await fetch(waUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tplBody),
      });
      const tplData = await tplResp.json();

      if (!tplData.messages) {
        failed++;
        results.push({
          wa_id: lead.wa_id,
          nombre: lead.nombre,
          estado: lead.estado_sofia,
          daysInactive,
          tier,
          success: false,
          reason: 'Template fallo: ' + (tplData.error?.message || 'unknown'),
        });
        continue;
      }

      // Registrar template en historial con metadata de revival
      historial.push({
        role: 'assistant',
        content: `[TEMPLATE:${WA_TEMPLATE_NAME}] Seguimiento revival (tier ${tier}d) enviado a ${firstName}`,
        timestamp: new Date().toISOString(),
        isTemplate: true,
        isRevival: true,
        revivalTier: tier,
      });

      // Guardar mensaje personalizado como pendiente — Sofia lo enviará cuando el lead responda
      await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({
          historial_chat: JSON.stringify(historial),
          mensaje_pendiente: JSON.stringify({ text: msg, isRevival: true, revivalTier: tier }),
          updated_at: new Date().toISOString(),
        }),
      });

      sent++;
      tierStats[tier]++;
      results.push({
        wa_id: lead.wa_id,
        nombre: lead.nombre,
        estado: lead.estado_sofia,
        daysInactive,
        tier,
        success: true,
        method: 'template+queued',
        queuedMessage: msg,
      });
    } catch (e) {
      failed++;
      results.push({
        wa_id: lead.wa_id,
        nombre: lead.nombre,
        estado: lead.estado_sofia,
        daysInactive,
        tier,
        success: false,
        reason: e.message,
      });
    }
  }

  return { sent, failed, skipped, total: leads.length, tierStats, results };
}

/**
 * POST /api/v1/whatsapp/revival
 * Ejecutar revival manualmente.
 * Body (opcional): { maxPerRun, dryRun, tiers }
 *   - dryRun: true → solo simula, retorna mensajes sin enviar
 *   - tiers: [3,7,14,30] → solo enviar a ciertos rangos
 */
export const runRevival = asyncHandler(async (req, res) => {
  const { maxPerRun, dryRun, tiers } = req.body || {};

  console.log(`🔄 Revival MANUAL iniciado por ${req.user?.nombre || 'admin'} — dryRun: ${!!dryRun}`);

  const result = await runRevivalCore({
    maxPerRun: maxPerRun || 50,
    dryRun: !!dryRun,
    tiers: Array.isArray(tiers) ? tiers : [3, 7, 14, 30],
  });

  // Actualizar estado en memoria para que /status lo refleje
  autoRevival.lastRun = new Date().toISOString();
  autoRevival.lastResult = { sent: result.sent, failed: result.failed, skipped: result.skipped, total: result.total, tierStats: result.tierStats, time: new Date().toISOString() };

  console.log(`🔄 Revival: ${result.sent} enviados, ${result.failed} fallidos, ${result.skipped} saltados de ${result.total} leads | Tiers: ${JSON.stringify(result.tierStats)}`);

  res.json({ success: true, ...result });
});

/**
 * GET /api/v1/whatsapp/revival/status
 * Estado del auto-revival
 */
export const getRevivalStatus = asyncHandler(async (req, res) => {
  res.json({
    active: autoRevival.active,
    intervalHours: autoRevival.intervalHours,
    maxPerRun: autoRevival.maxPerRun,
    lastRun: autoRevival.lastRun,
    lastResult: autoRevival.lastResult,
  });
});

/**
 * POST /api/v1/whatsapp/revival/config
 * Configurar el auto-revival
 * Body: { active, intervalHours, maxPerRun }
 */
export const configRevival = asyncHandler(async (req, res) => {
  const { active, intervalHours, maxPerRun } = req.body;

  if (intervalHours !== undefined) autoRevival.intervalHours = Math.max(1, Number(intervalHours) || 24);
  if (maxPerRun !== undefined) autoRevival.maxPerRun = Math.max(1, Math.min(100, Number(maxPerRun) || 30));

  if (active === true) {
    startAutoRevival();
  } else if (active === false) {
    stopAutoRevival();
  } else if (autoRevival.active) {
    // Si solo cambiaron params, reiniciar
    startAutoRevival();
  }

  res.json({
    success: true,
    active: autoRevival.active,
    intervalHours: autoRevival.intervalHours,
    maxPerRun: autoRevival.maxPerRun,
  });
});

// ── Cron job de revival ──
async function runAutoRevivalCycle() {
  console.log('🔄 Auto-revival ejecutándose...');
  try {
    const result = await runRevivalCore({
      maxPerRun: autoRevival.maxPerRun,
      dryRun: false,
      tiers: [3, 7, 14, 30],
    });

    autoRevival.lastRun = new Date().toISOString();
    autoRevival.lastResult = { ...result, results: undefined, time: new Date().toISOString() };
    console.log(`🔄 Auto-revival: ${result.sent} enviados, ${result.failed} fallidos, ${result.skipped} saltados de ${result.total} | Tiers: ${JSON.stringify(result.tierStats)}`);

    // Notificar al admin si se enviaron mensajes
    if (result.sent > 0 && SUPER_ADMIN_ID) {
      try {
        const app = global.__tesipediaApp;
        if (app) {
          await createNotification(app, {
            user: SUPER_ADMIN_ID,
            type: 'whatsapp',
            message: `🔄 Revival automático: ${result.sent} leads fríos contactados`,
            data: { tierStats: result.tierStats, sent: result.sent },
            link: '/admin/whatsapp',
          });
        }
      } catch { /* non-critical */ }
    }
  } catch (e) {
    console.error('Auto-revival error:', e.message);
    autoRevival.lastResult = { error: e.message, time: new Date().toISOString() };
  }
}

function startAutoRevival() {
  if (autoRevival._timer) clearInterval(autoRevival._timer);
  autoRevival.active = true;
  autoRevival._timer = setInterval(runAutoRevivalCycle, autoRevival.intervalHours * 60 * 60 * 1000);
  // Ejecutar la primera vez después de 5 minutos (para no saturar al arrancar)
  setTimeout(runAutoRevivalCycle, 5 * 60 * 1000);
  console.log(`🔄 Auto-revival ACTIVADO — cada ${autoRevival.intervalHours}h, max ${autoRevival.maxPerRun} leads por ciclo`);
}

function stopAutoRevival() {
  if (autoRevival._timer) clearInterval(autoRevival._timer);
  autoRevival._timer = null;
  autoRevival.active = false;
  console.log('🔄 Auto-revival DESACTIVADO');
}

/**
 * POST /api/v1/whatsapp/incoming-webhook
 * Webhook público (sin auth) que n8n/Sofia llama cuando un lead envía un mensaje.
 * Crea una notificación para el admin en tiempo real.
 * Soporta multimedia: si n8n envía media_id (de WhatsApp Cloud API), el backend
 * descarga el archivo, lo sube a Cloudinary y lo guarda en historial_chat.
 * Body: { wa_id, nombre, mensaje, is_new_lead?, media_id?, media_type?, mimetype?, filename?, caption? }
 */
export const incomingMessageWebhook = asyncHandler(async (req, res) => {
  const { wa_id, nombre, mensaje, is_new_lead, media_id, media_type, mimetype, filename, caption } = req.body;
  if (!wa_id) return res.status(400).json({ error: 'wa_id requerido' });

  const displayName = nombre || `+${wa_id}`;
  const hasMedia = !!media_id;
  const messageText = mensaje || caption || '';
  const preview = hasMedia
    ? `📎 ${media_type === 'image' ? 'Imagen' : media_type === 'audio' ? 'Audio' : media_type === 'video' ? 'Video' : 'Archivo'}${messageText ? ': ' + messageText.substring(0, 60) : ''}`
    : messageText ? (messageText.length > 80 ? messageText.substring(0, 80) + '...' : messageText) : '(mensaje)';

  // ── PROCESAR MULTIMEDIA DEL CLIENTE ──
  let mediaUrl = null;
  let mediaMetadata = {};

  if (hasMedia && WA_TOKEN) {
    try {
      console.log(`📥 Procesando media entrante: media_id=${media_id}, type=${media_type}, wa_id=${wa_id}`);

      // Paso 1: Obtener la URL de descarga del media desde WhatsApp API
      const mediaInfoResp = await fetch(`https://graph.facebook.com/v22.0/${media_id}`, {
        headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
      });
      if (!mediaInfoResp.ok) {
        const errText = await mediaInfoResp.text();
        throw new Error(`WA Media API info failed (${mediaInfoResp.status}): ${errText}`);
      }
      const mediaInfo = await mediaInfoResp.json();
      const downloadUrl = mediaInfo.url;

      if (!downloadUrl) throw new Error('WA Media API no devolvió URL de descarga');

      // Paso 2: Descargar el archivo binario desde WhatsApp
      const downloadResp = await fetch(downloadUrl, {
        headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
      });
      if (!downloadResp.ok) {
        throw new Error(`WA Media download failed (${downloadResp.status})`);
      }
      const mediaBuffer = Buffer.from(await downloadResp.arrayBuffer());
      console.log(`📥 Media descargado: ${mediaBuffer.length} bytes, type=${mimetype || media_type}`);

      // Paso 3: Determinar tipo de recurso para Cloudinary
      const effectiveMimetype = mimetype || mediaInfo.mime_type || '';
      const isAudio = !!effectiveMimetype.match(/audio|ogg|opus/i) || media_type === 'audio';
      const isDoc = !!effectiveMimetype.match(/pdf|msword|officedocument|csv|text/i) || media_type === 'document';
      const isVideo = !!effectiveMimetype.match(/video\//i) || media_type === 'video';
      const isImage = !!effectiveMimetype.match(/image\//i) || media_type === 'image';

      const ts = Date.now();
      const rnd = Math.floor(Math.random() * 10000);
      let uploadBuffer = mediaBuffer;
      let cloudinaryOptions = { folder: 'whatsapp_admin_media' };
      let finalMimetype = effectiveMimetype;
      let finalFilename = filename || `media_${ts}`;

      if (isAudio) {
        // Convertir audio a OGG/Opus para reproducción consistente en el admin
        try {
          const inExt = effectiveMimetype.includes('mp4') ? 'mp4' : effectiveMimetype.includes('ogg') ? 'ogg' : 'webm';
          const tmpIn = join(tmpdir(), `wa_incoming_audio_${ts}.${inExt}`);
          const tmpWav = join(tmpdir(), `wa_incoming_clean_${ts}.wav`);
          const tmpOut = join(tmpdir(), `wa_incoming_out_${ts}.ogg`);
          writeFileSync(tmpIn, mediaBuffer);

          execSync(`${ffmpegPath} -hide_banner -loglevel error -nostdin -y -i "${tmpIn}" -vn -map_metadata -1 -ac 1 -ar 48000 -c:a pcm_s16le "${tmpWav}"`, { timeout: 15000 });
          execSync(`${ffmpegPath} -hide_banner -loglevel error -nostdin -y -i "${tmpWav}" -c:a libopus -b:a 32k -ac 1 -ar 48000 -avoid_negative_ts make_zero "${tmpOut}"`, { timeout: 15000 });

          uploadBuffer = readFileSync(tmpOut);
          try { unlinkSync(tmpIn); unlinkSync(tmpWav); unlinkSync(tmpOut); } catch (_) {}
          console.log(`✅ Audio entrante convertido: ${mediaBuffer.length}b → ${uploadBuffer.length}b ogg/opus`);
        } catch (convErr) {
          console.error('⚠️ ffmpeg conversion failed para audio entrante, subiendo original:', convErr.message);
        }

        cloudinaryOptions.resource_type = 'video'; // Cloudinary sirve audio/ogg con resource_type 'video'
        cloudinaryOptions.public_id = `incoming_audio_${ts}_${rnd}`;
        cloudinaryOptions.format = 'ogg';
        finalMimetype = 'audio/ogg';
        finalFilename = (filename || 'audio').replace(/\.[^.]+$/, '') + '.ogg';
      } else if (isDoc) {
        const ext = filename?.includes('.') ? filename.split('.').pop() : 'pdf';
        cloudinaryOptions.resource_type = 'raw';
        cloudinaryOptions.public_id = `incoming_doc_${ts}_${rnd}.${ext}`;
        finalFilename = filename || `documento_${ts}.${ext}`;
      } else if (isVideo) {
        cloudinaryOptions.resource_type = 'video';
        cloudinaryOptions.public_id = `incoming_video_${ts}_${rnd}`;
        finalFilename = filename || `video_${ts}.mp4`;
      } else {
        // Imagen u otro
        cloudinaryOptions.resource_type = 'auto';
        cloudinaryOptions.public_id = `incoming_img_${ts}_${rnd}`;
        finalFilename = filename || `imagen_${ts}.jpg`;
      }

      // Paso 4: Subir a Cloudinary
      const b64 = `data:${isAudio ? 'audio/ogg' : effectiveMimetype};base64,${uploadBuffer.toString('base64')}`;
      const cloudResult = await cloudinary.uploader.upload(b64, cloudinaryOptions);
      mediaUrl = cloudResult.secure_url;

      mediaMetadata = {
        mediaUrl,
        mimetype: finalMimetype,
        filename: finalFilename,
        mediaType: isAudio ? 'audio' : isDoc ? 'document' : isVideo ? 'video' : 'image',
      };

      console.log(`✅ Media entrante subido a Cloudinary: ${mediaUrl} (${mediaMetadata.mediaType})`);
    } catch (mediaErr) {
      console.error(`❌ Error procesando media entrante (media_id=${media_id}):`, mediaErr.message);
      // No bloquear el webhook — el mensaje de texto aún se procesará
    }
  }

  // ── GUARDAR MEDIA EN HISTORIAL_CHAT ──
  // Si se procesó multimedia, actualizar el historial del lead en Supabase
  if (mediaUrl) {
    try {
      const leadUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=historial_chat&limit=1`;
      const leadResp = await fetch(leadUrl, { headers: supabaseHeaders() });
      if (leadResp.ok) {
        const leadData = await leadResp.json();
        if (leadData.length > 0) {
          let historial = [];
          try { historial = JSON.parse(leadData[0].historial_chat || '[]'); } catch (_) { historial = []; }

          // Buscar el último mensaje del usuario para agregar media
          // Si n8n ya escribió el mensaje de texto, encontramos el último msg del user y le agregamos media
          let mediaAdded = false;
          for (let i = historial.length - 1; i >= 0; i--) {
            const msg = historial[i];
            if (msg.role === 'user' && !msg.mediaUrl) {
              // Agregar metadata de media al mensaje existente
              historial[i] = { ...msg, ...mediaMetadata };
              mediaAdded = true;
              console.log(`✅ Media agregada al mensaje existente en historial (index=${i})`);
              break;
            }
            // Solo buscar en los últimos 3 mensajes para no modificar mensajes viejos
            if (historial.length - 1 - i >= 3) break;
          }

          // Si no encontramos un mensaje reciente del usuario, crear uno nuevo con la media
          if (!mediaAdded) {
            const newMsg = {
              role: 'user',
              content: messageText || '',
              timestamp: new Date().toISOString(),
              ...mediaMetadata,
            };
            historial.push(newMsg);
            console.log(`✅ Nuevo mensaje con media creado en historial`);
          }

          // Guardar historial actualizado
          const updateUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
          await fetch(updateUrl, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({
              historial_chat: JSON.stringify(historial),
              updated_at: new Date().toISOString(),
            }),
          });
        }
      }
    } catch (histErr) {
      console.error('❌ Error actualizando historial con media:', histErr.message);
    }
  }

  // ── NOTIFICACIONES ──
  if (SUPER_ADMIN_ID) {
    await createNotification(req.app, {
      user: SUPER_ADMIN_ID,
      type: 'whatsapp',
      message: `💬 ${displayName}: ${preview}`,
      data: { wa_id, nombre: displayName },
      link: '/admin/whatsapp',
      priority: 'medium',
    });

    if (is_new_lead) {
      await createNotification(req.app, {
        user: SUPER_ADMIN_ID,
        type: 'lead',
        message: `🆕 Nuevo lead: ${displayName}`,
        data: { wa_id, nombre: displayName },
        link: '/admin/whatsapp',
        priority: 'high',
      });
    }
  }

  // ── ENVIAR MENSAJES PENDIENTES ──
  // Cuando el usuario responde, se reabre la ventana de 24h.
  // Verificar si hay un mensaje_pendiente y enviarlo ahora.
  try {
    const leadUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=mensaje_pendiente,historial_chat&limit=1`;
    const leadResp = await fetch(leadUrl, { headers: supabaseHeaders() });
    if (leadResp.ok) {
      const leadData = await leadResp.json();
      if (leadData.length > 0 && leadData[0].mensaje_pendiente) {
        let pending;
        try { pending = JSON.parse(leadData[0].mensaje_pendiente); } catch (_) { pending = null; }

        if (pending) {
          console.log(`📨 Enviando mensaje pendiente para ${wa_id}:`, JSON.stringify(pending));
          const cleanNumber = wa_id.replace(/\D/g, '');
          const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
          const payload = { messaging_product: 'whatsapp', to: cleanNumber };
          let sent = false;

          if (pending.mediaType === 'audio') {
            payload.type = 'audio';
            if (pending.waAudioMediaId) {
              // Usar el media_id de WA Media API (subido cuando se creó el pendiente)
              payload.audio = { id: pending.waAudioMediaId };
            } else if (pending.mediaUrl) {
              payload.audio = { link: pending.mediaUrl };
            }
          } else if (pending.mediaType && pending.mediaUrl) {
            payload.type = pending.mediaType;
            payload[pending.mediaType] = { link: pending.mediaUrl };
            if (pending.mensaje) payload[pending.mediaType].caption = pending.mensaje;
            if (pending.mediaType === 'document' && pending.filename) {
              payload.document.filename = pending.filename;
            }
          } else if (pending.mensaje || pending.text) {
            payload.type = 'text';
            payload.text = { body: pending.mensaje || pending.text };
          }

          if (payload.type) {
            const waResp = await fetch(waUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${WA_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            });
            const waResult = await waResp.json();
            console.log(`📨 Mensaje pendiente enviado para ${wa_id}:`, JSON.stringify(waResult));
            sent = waResp.ok;

            // Si es audio y el media_id falló, intentar enviar el texto por separado
            if (!sent && pending.mensaje && pending.mediaType === 'audio') {
              const textPayload = {
                messaging_product: 'whatsapp', to: cleanNumber,
                type: 'text', text: { body: pending.mensaje },
              };
              await fetch(waUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(textPayload),
              });
            }
          }

          // Actualizar historial: marcar pendiente como enviado y limpiar mensaje_pendiente
          let historial = [];
          try { historial = JSON.parse(leadData[0].historial_chat || '[]'); } catch (_) { historial = []; }
          historial = historial.map(msg => {
            if (msg.delivery_status === 'pending') {
              return { ...msg, delivery_status: sent ? 'sent' : 'failed' };
            }
            return msg;
          });

          const clearUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
          await fetch(clearUrl, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({
              mensaje_pendiente: null,
              historial_chat: JSON.stringify(historial),
              updated_at: new Date().toISOString(),
            }),
          });
          console.log(`✅ mensaje_pendiente limpiado para ${wa_id}`);
        }
      }
    }
  } catch (pendingErr) {
    console.error('❌ Error enviando mensaje pendiente:', pendingErr.message);
  }

  // ── DETECCIÓN DE OPT-OUT (STOP / no más mensajes) ──
  const msgLower = (messageText || '').toLowerCase().trim();
  const STOP_KEYWORDS = ['stop', 'para', 'basta', 'no mas mensajes', 'no más mensajes', 'dejen de escribir', 'no me escriban', 'ya no quiero mensajes', 'cancelar mensajes', 'no quiero recibir'];
  const isOptOut = STOP_KEYWORDS.some(kw => msgLower === kw || msgLower.includes(kw));

  if (isOptOut) {
    try {
      console.log(`🛑 Opt-out detectado de ${wa_id}: "${messageText}"`);
      // Bloquear el lead
      const blockUrl = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`;
      await fetch(blockUrl, {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({
          bloqueado: true,
          updated_at: new Date().toISOString(),
        }),
      });

      // Enviar mensaje de confirmación
      const cleanNumber = wa_id.replace(/\D/g, '');
      await fetch(`https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'text',
          text: { body: 'Entendido, no te enviaremos mas mensajes. Si en algun momento necesitas ayuda con tu proyecto academico, solo escribenos y con gusto te atendemos. Mucho exito! 🎓' },
        }),
      });

      console.log(`✅ Lead ${wa_id} bloqueado por opt-out y confirmación enviada`);
    } catch (optOutErr) {
      console.error('❌ Error procesando opt-out:', optOutErr.message);
    }
  }

  res.json({ ok: true, media_processed: !!mediaUrl, mediaUrl: mediaUrl || undefined, opted_out: isOptOut || undefined });
});

/* ═══════════════════════════════════════════════════════════════════
 *  QUOTE FOLLOW-UP — Seguimiento automático a leads con cotización
 *  Envía recordatorios escalonados a leads que recibieron cotización
 *  pero no han confirmado / pagado.
 *  Tiers: 1d (recordatorio), 3d (beneficio), 7d (urgencia), 14d (oferta)
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Clasifica un lead cotizado en su tier de seguimiento
 */
function getFollowUpTier(daysInactive) {
  if (daysInactive >= 14) return 14;
  if (daysInactive >= 7) return 7;
  if (daysInactive >= 3) return 3;
  if (daysInactive >= 1) return 1;
  return null;
}

/**
 * Genera mensaje de seguimiento personalizado para leads con cotización
 */
function buildQuoteFollowUpMessage(lead, tier) {
  const nombre = (lead.nombre || '').split(' ')[0];
  const saludo = nombre ? `Hola ${nombre}` : 'Hola';
  const tieneTema = !!lead.tema;
  const tienePrecio = !!lead.precio;
  const tieneProyecto = !!lead.tipo_proyecto;
  const proyectoLabel = (lead.tipo_proyecto || 'proyecto').toLowerCase();
  const precioPrev = tienePrecio ? ` de $${lead.precio} MXN` : '';

  // ── TIER 1 DÍA — Recordatorio suave ──
  if (tier === 1) {
    if (tieneTema) {
      return `${saludo}, soy Sofia de Tesipedia! 😊 Ayer te enviamos la cotizacion para tu ${proyectoLabel} sobre "${lead.tema}"${precioPrev}. Queria saber si tuviste oportunidad de revisarla. Tienes alguna duda? Estoy aqui para ayudarte!`;
    }
    return `${saludo}, soy Sofia de Tesipedia! 😊 Ayer te enviamos tu cotizacion${precioPrev} y queria saber si pudiste revisarla. Si tienes alguna pregunta sobre el servicio o los tiempos de entrega, con gusto te ayudo!`;
  }

  // ── TIER 3 DÍAS — Beneficio, resolver dudas ──
  if (tier === 3) {
    if (tieneTema) {
      return `${saludo}, soy Sofia de Tesipedia! Han pasado unos dias desde que te enviamos la cotizacion para "${lead.tema}"${precioPrev}. Muchos estudiantes nos preguntan sobre los tiempos de entrega y la metodologia, si tienes alguna duda similar con gusto te oriento. Recuerda que mientras antes comiences, mejor calidad podemos garantizar. Que opinas?`;
    }
    return `${saludo}, soy Sofia de Tesipedia! Tu cotizacion${precioPrev} sigue vigente. Queria comentarte que nuestro equipo tiene experiencia en mas de 500 proyectos y ofrecemos revisiones incluidas. Si el precio o los tiempos te generan dudas, platiquemos para buscar una opcion que se ajuste a ti.`;
  }

  // ── TIER 7 DÍAS — Urgencia + disponibilidad ──
  if (tier === 7) {
    if (tieneTema) {
      return `${saludo}, soy Sofia de Tesipedia! Ya paso una semana desde tu cotizacion para "${lead.tema}"${precioPrev}. Te escribo porque la disponibilidad de nuestros redactores cambia cada semana y no quiero que pierdas tu lugar. Si decides avanzar, podemos comenzar de inmediato. Te interesa?`;
    }
    return `${saludo}, soy Sofia de Tesipedia! Tu cotizacion${precioPrev} tiene una semana. Quiero ser transparente: los precios pueden ajustarse conforme se acercan las fechas de entrega. Si confirmas esta semana, te garantizamos el precio actual y disponibilidad inmediata. Que dices?`;
  }

  // ── TIER 14 DÍAS — Última oportunidad + oferta ──
  if (tier >= 14) {
    if (tieneTema) {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Tu cotizacion para "${lead.tema}" ya tiene dos semanas. Como ultimo seguimiento, quiero ofrecerte un 10% de descuento especial si confirmas esta semana. ${tienePrecio ? `Tu precio pasaria de $${lead.precio} a $${Math.round(lead.precio * 0.9)} MXN.` : 'Aplicaria sobre tu cotizacion actual.'} Es nuestra forma de motivarte a no dejar tu proyecto para despues. Te interesa?`;
    }
    return `${saludo}, soy Sofia de Tesipedia! 🎓 Este es mi ultimo seguimiento sobre tu cotizacion${precioPrev}. Como incentivo especial, tenemos un 10% de descuento si confirmas esta semana. No dejes tu proyecto academico para el final, cada dia cuenta. Que opinas?`;
  }

  // Fallback
  return `${saludo}, soy Sofia de Tesipedia! Queria dar seguimiento a la cotizacion que te enviamos. Si tienes alguna duda o quieres ajustar algo, estoy aqui para ayudarte!`;
}

// ── Estado en memoria del quote follow-up automático ──
const autoQuoteFollowUp = {
  active: false,
  intervalHours: 12,        // Corre cada 12 horas
  maxPerRun: 40,             // Max leads por ejecución
  lastRun: null,
  lastResult: null,
  _timer: null,
};

/**
 * Core: busca leads con cotización enviada y manda seguimiento escalonado
 */
async function runQuoteFollowUpCore(options = {}) {
  const ADMIN_IDS = ['5215583352096', '525561757123', '525512478395', '5215541004180', '5215561757123'];
  const maxPerRun = options.maxPerRun || autoQuoteFollowUp.maxPerRun;
  const dryRun = options.dryRun || false;
  const allowedTiers = options.tiers || [1, 3, 7, 14];

  // Buscar leads que:
  // 1. Tienen estado_sofia = 'cotizacion_enviada' O estado cotizando con precio
  // 2. No están bloqueados
  // 3. Se actualizaron hace más de 1 día (para dar tiempo a que respondan)
  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

  // Query: leads cotizados que no han respondido en 1+ día (excluye pagados y bloqueados)
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${oneDayAgo}&bloqueado=neq.true&estado_sofia=not.in.(pagado,cliente_acepto)&or=(estado_sofia.eq.cotizacion_enviada,and(estado_sofia.eq.cotizando,precio.neq.null))&select=wa_id,nombre,estado_sofia,updated_at,created_at,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega,precio,cotizacion_enviada,modo_humano,pdf_url&order=updated_at.asc&limit=500`;

  const resp = await fetch(url, { headers: supabaseHeaders() });
  if (!resp.ok) {
    throw new Error(`Supabase error ${resp.status}`);
  }

  const allLeads = await resp.json();
  const leads = allLeads.filter(l => !ADMIN_IDS.includes(l.wa_id));

  const results = [];
  const tierStats = { 1: 0, 3: 0, 7: 0, 14: 0 };
  let sent = 0, failed = 0, skipped = 0;

  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;

  for (const lead of leads) {
    if (sent >= maxPerRun) break;

    const daysInactive = getDaysInactive(lead);
    const tier = getFollowUpTier(daysInactive);

    if (!tier || !allowedTiers.includes(tier)) continue;

    // ── Obtener historial ──
    let historial = [];
    try {
      const histResp = await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}&select=historial_chat&limit=1`, { headers: supabaseHeaders() });
      if (histResp.ok) {
        const histData = await histResp.json();
        const raw = histData[0]?.historial_chat;
        if (Array.isArray(raw)) historial = raw;
        else if (typeof raw === 'string' && raw.trim()) {
          try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
        }
      }
    } catch { /* continuar sin historial */ }

    // ── No enviar si ya mandamos follow-up en este tier ──
    const lastFollowUp = [...historial].reverse().find(m => m.isQuoteFollowUp);
    if (lastFollowUp && lastFollowUp.followUpTier === tier) {
      skipped++;
      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, tier, success: false, reason: `Ya recibio follow-up tier ${tier}` });
      continue;
    }

    // ── Max 3 follow-ups sin respuesta ──
    let consecutive = 0;
    for (let i = historial.length - 1; i >= 0; i--) {
      if (historial[i].role === 'user') break;
      if (historial[i].isQuoteFollowUp || historial[i].isRevival || historial[i].isReengagement || historial[i].isTemplate) consecutive++;
    }
    if (consecutive >= 3) {
      skipped++;
      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, tier, success: false, reason: `Max follow-ups alcanzado (${consecutive})` });
      continue;
    }

    const msg = buildQuoteFollowUpMessage(lead, tier);

    if (dryRun) {
      sent++;
      tierStats[tier]++;
      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, tier, success: true, dryRun: true, message: msg });
      continue;
    }

    // ── Enviar template (ventana probablemente expirada) + guardar mensaje pendiente ──
    const cleanNumber = lead.wa_id.replace(/\D/g, '');
    const firstName = (lead.nombre || 'amigo').split(' ')[0];

    try {
      // Primero intentar envío directo (por si la ventana está abierta)
      let sentDirect = false;
      if (!isWindowExpired(historial, lead.updated_at)) {
        const directResp = await fetch(waUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: cleanNumber, type: 'text', text: { body: msg } }),
        });
        const directData = await directResp.json();
        if (directData.messages) {
          sentDirect = true;
          historial.push({
            role: 'assistant',
            content: msg,
            timestamp: new Date().toISOString(),
            isQuoteFollowUp: true,
            followUpTier: tier,
            wa_message_id: directData.messages[0]?.id || null,
            delivery_status: 'sent',
          });
          await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({ historial_chat: JSON.stringify(historial), updated_at: new Date().toISOString() }),
          });
        }
      }

      // Si no se pudo enviar directo, usar template + queue
      if (!sentDirect) {
        const tplBody = {
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'template',
          template: {
            name: WA_TEMPLATE_NAME,
            language: { code: WA_TEMPLATE_LANG },
            components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }],
          },
        };
        const tplResp = await fetch(waUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(tplBody),
        });
        const tplData = await tplResp.json();

        if (!tplData.messages) {
          failed++;
          results.push({ wa_id: lead.wa_id, nombre: lead.nombre, tier, success: false, reason: 'Template fallo: ' + (tplData.error?.message || 'unknown') });
          continue;
        }

        historial.push({
          role: 'assistant',
          content: `[TEMPLATE:${WA_TEMPLATE_NAME}] Seguimiento cotización (tier ${tier}d) enviado a ${firstName}`,
          timestamp: new Date().toISOString(),
          isTemplate: true,
          isQuoteFollowUp: true,
          followUpTier: tier,
        });

        await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({
            historial_chat: JSON.stringify(historial),
            mensaje_pendiente: JSON.stringify({ text: msg, isQuoteFollowUp: true, followUpTier: tier }),
            updated_at: new Date().toISOString(),
          }),
        });
      }

      sent++;
      tierStats[tier]++;
      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, tier, success: true, method: sentDirect ? 'direct' : 'template+queued' });
    } catch (e) {
      failed++;
      results.push({ wa_id: lead.wa_id, nombre: lead.nombre, tier, success: false, reason: e.message });
    }
  }

  return { sent, failed, skipped, total: leads.length, tierStats, results };
}

/**
 * POST /api/v1/whatsapp/quote-followup
 * Ejecutar seguimiento de cotizaciones manualmente
 * Body (opcional): { maxPerRun, dryRun, tiers }
 */
export const runQuoteFollowUp = asyncHandler(async (req, res) => {
  const { maxPerRun, dryRun, tiers } = req.body || {};

  console.log(`📩 Quote follow-up MANUAL iniciado por ${req.user?.name || 'admin'} — dryRun: ${!!dryRun}`);

  const result = await runQuoteFollowUpCore({
    maxPerRun: maxPerRun || 50,
    dryRun: !!dryRun,
    tiers: Array.isArray(tiers) ? tiers : [1, 3, 7, 14],
  });

  // Actualizar estado en memoria para que /status lo refleje
  autoQuoteFollowUp.lastRun = new Date().toISOString();
  autoQuoteFollowUp.lastResult = { sent: result.sent, failed: result.failed, skipped: result.skipped, total: result.total, tierStats: result.tierStats, time: new Date().toISOString() };

  console.log(`📩 Quote follow-up: ${result.sent} enviados, ${result.failed} fallidos, ${result.skipped} saltados de ${result.total} leads`);

  res.json({ success: true, ...result });
});

/**
 * GET /api/v1/whatsapp/quote-followup/status
 */
export const getQuoteFollowUpStatus = asyncHandler(async (req, res) => {
  res.json({
    active: autoQuoteFollowUp.active,
    intervalHours: autoQuoteFollowUp.intervalHours,
    maxPerRun: autoQuoteFollowUp.maxPerRun,
    lastRun: autoQuoteFollowUp.lastRun,
    lastResult: autoQuoteFollowUp.lastResult,
  });
});

/**
 * POST /api/v1/whatsapp/quote-followup/config
 * Body: { active, intervalHours, maxPerRun }
 */
export const configQuoteFollowUp = asyncHandler(async (req, res) => {
  const { active, intervalHours, maxPerRun } = req.body;

  if (intervalHours !== undefined) autoQuoteFollowUp.intervalHours = Math.max(1, Number(intervalHours) || 12);
  if (maxPerRun !== undefined) autoQuoteFollowUp.maxPerRun = Math.max(1, Math.min(100, Number(maxPerRun) || 40));

  if (active === true) {
    startQuoteFollowUp();
  } else if (active === false) {
    stopQuoteFollowUp();
  } else if (autoQuoteFollowUp.active) {
    startQuoteFollowUp(); // reiniciar con nuevos params
  }

  res.json({
    success: true,
    active: autoQuoteFollowUp.active,
    intervalHours: autoQuoteFollowUp.intervalHours,
    maxPerRun: autoQuoteFollowUp.maxPerRun,
  });
});

// ── Cron job de quote follow-up ──
async function runAutoQuoteFollowUpCycle() {
  console.log('📩 Auto quote follow-up ejecutándose...');
  try {
    const result = await runQuoteFollowUpCore({
      maxPerRun: autoQuoteFollowUp.maxPerRun,
      dryRun: false,
      tiers: [1, 3, 7, 14],
    });

    autoQuoteFollowUp.lastRun = new Date().toISOString();
    autoQuoteFollowUp.lastResult = { sent: result.sent, failed: result.failed, skipped: result.skipped, total: result.total, tierStats: result.tierStats, time: new Date().toISOString() };
    console.log(`📩 Auto quote follow-up: ${result.sent} enviados, ${result.failed} fallidos, ${result.skipped} saltados de ${result.total}`);

    // Notificar al admin si se enviaron mensajes
    if (result.sent > 0 && SUPER_ADMIN_ID) {
      try {
        const app = global.__tesipediaApp;
        if (app) {
          await createNotification(app, {
            user: SUPER_ADMIN_ID,
            type: 'whatsapp',
            message: `📩 Seguimiento automático: ${result.sent} leads cotizados contactados`,
            data: { tierStats: result.tierStats, sent: result.sent },
            link: '/admin/whatsapp',
          });
        }
      } catch { /* non-critical */ }
    }
  } catch (e) {
    console.error('Auto quote follow-up error:', e.message);
    autoQuoteFollowUp.lastResult = { error: e.message, time: new Date().toISOString() };
  }
}

function startQuoteFollowUp() {
  if (autoQuoteFollowUp._timer) clearInterval(autoQuoteFollowUp._timer);
  autoQuoteFollowUp.active = true;
  autoQuoteFollowUp._timer = setInterval(runAutoQuoteFollowUpCycle, autoQuoteFollowUp.intervalHours * 60 * 60 * 1000);
  setTimeout(runAutoQuoteFollowUpCycle, 10 * 60 * 1000); // Primera ejecución a los 10 min
  console.log(`📩 Auto quote follow-up ACTIVADO — cada ${autoQuoteFollowUp.intervalHours}h, max ${autoQuoteFollowUp.maxPerRun} leads`);
}

function stopQuoteFollowUp() {
  if (autoQuoteFollowUp._timer) clearInterval(autoQuoteFollowUp._timer);
  autoQuoteFollowUp._timer = null;
  autoQuoteFollowUp.active = false;
  console.log('📩 Auto quote follow-up DESACTIVADO');
}

// ═══════════════════════════════════════════════════════════
// ═══  MANYCHAT REACTIVATION — Importar y reactivar leads ═══
// ═══════════════════════════════════════════════════════════

import {
  getAllContacts as getManyChatContacts,
  getContactsBySegment as getManyChatBySegment,
  SEGMENT_PRIORITY,
  EXCLUDE_PHONES as MC_EXCLUDE,
  ADMIN_PHONES as MC_ADMIN,
} from '../data/manychatContacts.js';

// ── Estado en memoria de la reactivación ManyChat ──
const manychatReactivation = {
  importResult: null,     // Resultado del último import
  sendResult: null,       // Resultado del último envío
  lastImport: null,
  lastSend: null,
};

/**
 * Genera un mensaje personalizado para leads de ManyChat según su segmento
 * y datos existentes en Supabase (si los tiene).
 * Distinto al revival: estos son mensajes más directos ya que el lead viene de ManyChat.
 */
function buildManyChatMessage(contact, existingLead) {
  const nombre = (existingLead?.nombre || contact.nombre || '').split(' ')[0];
  const saludo = nombre ? `Hola ${nombre}` : 'Hola';
  const segment = contact.segment;

  // Si el lead ya existe en Supabase y tiene datos, usar mensaje contextual
  if (existingLead && existingLead.estado_sofia) {
    const estado = existingLead.estado_sofia;

    // Lead que ya tiene cotización enviada → mensaje directo de seguimiento
    if (estado === 'cotizacion_enviada' || existingLead.cotizacion_enviada) {
      const tema = existingLead.tema ? ` sobre "${existingLead.tema}"` : '';
      return `${saludo}, soy Sofia de Tesipedia! 😊 Te habíamos enviado una cotización${tema} y quería saber si la pudiste revisar. ¿Tienes alguna duda o quieres que la actualicemos? Estoy aquí para ayudarte!`;
    }

    // Lead cotizando → empujarlo a cerrar
    if (estado === 'cotizando') {
      return `${saludo}, soy Sofia de Tesipedia! 😊 Tu cotización${existingLead.tema ? ` para "${existingLead.tema}"` : ''} está casi lista. ¿Quieres que te la envíe? Solo confirma y te la mando en un momento.`;
    }

    // Lead calificando → retomar donde se quedó
    if (estado === 'calificando') {
      if (existingLead.tema) {
        return `${saludo}, soy Sofia de Tesipedia! 😊 Estábamos platicando sobre tu proyecto de "${existingLead.tema}" y nos quedamos a medias. Me encantaría retomar para darte tu cotización. ¿Continuamos?`;
      }
      if (existingLead.tipo_servicio) {
        const servicioLabel = { servicio_1: 'redacción completa', servicio_2: 'corrección de estilo', servicio_3: 'asesoría' }[existingLead.tipo_servicio] || existingLead.tipo_servicio;
        return `${saludo}, soy Sofia de Tesipedia! 😊 Estábamos hablando sobre tu ${servicioLabel} y me faltan unos datos para cotizarte. ¿Retomamos? Solo serán un par de minutos.`;
      }
      return `${saludo}, soy Sofia de Tesipedia! 😊 Estábamos en medio de una plática sobre tu proyecto académico. ¿Quieres que retomemos donde nos quedamos?`;
    }

    // Lead descartado → re-interesar
    if (estado === 'descartado') {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Sé que hace tiempo platicamos y no se concretó, pero quería saber si tu proyecto académico${existingLead.tema ? ` sobre "${existingLead.tema}"` : ''} sigue pendiente. Tenemos nuevas opciones y precios accesibles. ¿Te interesa saber más?`;
    }

    // Lead cerrado → no molestar (esto no debería llegar aquí, pero por si acaso)
    if (estado === 'cerrado') {
      return null; // No enviar
    }
  }

  // ── Lead nuevo o en bienvenida: mensaje basado en segmento ManyChat ──
  if (segment === 'SUPER_HOT') {
    return `${saludo}, soy Sofia de Tesipedia! 🎓 Vi que habías solicitado información sobre nuestros servicios de tesis. ¿Pudiste avanzar con tu proyecto o aún necesitas apoyo? Tenemos opciones muy accesibles y podemos empezar cuando quieras. ¡Cuéntame!`;
  }
  if (segment === 'HOT') {
    return `${saludo}, soy Sofia de Tesipedia! 😊 Quería darte seguimiento porque vi que te interesaste en nuestros servicios. ¿Sigues necesitando apoyo con tu tesis o proyecto académico? Estoy aquí para orientarte sin compromiso.`;
  }
  if (segment === 'WARM') {
    return `${saludo}, soy Sofia de Tesipedia! 📚 Hace poco nos contactaste y quería saber cómo vas con tu proyecto académico. Si aún lo tienes pendiente, podemos ayudarte con asesoría profesional a precios muy accesibles. ¿Te interesa?`;
  }
  if (segment === 'TIBIO_1' || segment === 'TIBIO_2') {
    return `${saludo}, soy Sofia de Tesipedia! 🎓 Hace unas semanas nos contactaste sobre tu proyecto académico. ¿Sigues necesitando apoyo? Tenemos opciones flexibles y este mes hay promociones especiales. ¡Escríbeme y platicamos!`;
  }
  if (segment === 'FRIO') {
    return `${saludo}, soy Sofia de Tesipedia! 🎓 Hace tiempo mostraste interés en nuestros servicios de tesis. ¿Ya terminaste tu proyecto o aún lo tienes pendiente? Este mes tenemos promociones especiales para retomar. ¡Aquí estamos para ayudarte!`;
  }
  // NEVER o sin segmento
  return `${saludo}, soy Sofia de Tesipedia! 🎓 ¿Necesitas apoyo con tu tesis o proyecto de titulación? Ofrecemos redacción, corrección de estilo y asesoría a precios accesibles. ¡Escríbeme y te oriento sin compromiso!`;
}

/**
 * POST /api/v1/whatsapp/manychat/import
 * Importa contactos de ManyChat a Supabase.
 * - Crea leads nuevos con origen='manychat'
 * - Para existentes: actualiza origen y manychat_segment sin sobreescribir datos
 * Body (opcional): { segments, dryRun }
 */
export const importManyChatLeads = asyncHandler(async (req, res) => {
  const { segments, dryRun } = req.body || {};

  console.log(`📱 ManyChat IMPORT iniciado — dryRun: ${!!dryRun}`);

  // Determinar qué segmentos importar
  let contacts;
  if (Array.isArray(segments) && segments.length > 0) {
    contacts = [];
    for (const seg of segments) {
      contacts.push(...getManyChatBySegment(seg));
    }
  } else {
    contacts = getManyChatContacts();
  }

  console.log(`📱 Contactos a importar: ${contacts.length}`);

  const results = { created: 0, updated: 0, skipped: 0, failed: 0, details: [] };

  for (const contact of contacts) {
    const wa_id = contact.wa_id.replace(/\D/g, '');

    try {
      // 1. Verificar si ya existe en Supabase
      const checkResp = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=wa_id,nombre,estado_sofia,origen,manychat_segment&limit=1`,
        { headers: supabaseHeaders() }
      );

      if (!checkResp.ok) {
        results.failed++;
        results.details.push({ wa_id, action: 'error', reason: `Supabase GET error ${checkResp.status}` });
        continue;
      }

      const existing = await checkResp.json();

      if (dryRun) {
        const action = existing.length > 0 ? 'update' : 'create';
        results[action === 'update' ? 'updated' : 'created']++;
        results.details.push({ wa_id, nombre: contact.nombre, segment: contact.segment, action, dryRun: true });
        continue;
      }

      if (existing.length > 0) {
        // Lead ya existe → actualizar origen y segmento sin sobreescribir otros datos
        const lead = existing[0];

        // Solo actualizar si no tiene origen o es diferente
        const patchBody = {};
        if (!lead.origen) patchBody.origen = 'manychat';
        if (!lead.manychat_segment) patchBody.manychat_segment = contact.segment;

        // Si el nombre de ManyChat es mejor que el que tiene (y no tiene nombre)
        if (contact.nombre && (!lead.nombre || lead.nombre.trim() === '')) {
          patchBody.nombre = contact.nombre;
        }

        if (Object.keys(patchBody).length > 0) {
          patchBody.updated_at = new Date().toISOString();
          await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify(patchBody),
          });
          results.updated++;
          results.details.push({ wa_id, nombre: lead.nombre || contact.nombre, segment: contact.segment, action: 'updated', fields: Object.keys(patchBody) });
        } else {
          results.skipped++;
          results.details.push({ wa_id, nombre: lead.nombre, segment: contact.segment, action: 'skipped', reason: 'Ya tiene origen y segmento' });
        }
      } else {
        // Lead no existe → crear nuevo
        const newLead = {
          wa_id,
          nombre: contact.nombre || '',
          estado_sofia: 'bienvenida',
          origen: 'manychat',
          manychat_segment: contact.segment,
          historial_chat: JSON.stringify([]),
          modo_humano: false,
          bloqueado: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const createResp = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
          method: 'POST',
          headers: { ...supabaseHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify(newLead),
        });

        if (createResp.ok || createResp.status === 201) {
          results.created++;
          results.details.push({ wa_id, nombre: contact.nombre, segment: contact.segment, action: 'created' });
        } else {
          const errText = await createResp.text();
          results.failed++;
          results.details.push({ wa_id, nombre: contact.nombre, segment: contact.segment, action: 'error', reason: errText.substring(0, 200) });
        }
      }
    } catch (e) {
      results.failed++;
      results.details.push({ wa_id, nombre: contact.nombre, segment: contact.segment, action: 'error', reason: e.message });
    }
  }

  manychatReactivation.importResult = { ...results, details: results.details.length };
  manychatReactivation.lastImport = new Date().toISOString();

  console.log(`📱 ManyChat import: ${results.created} creados, ${results.updated} actualizados, ${results.skipped} sin cambios, ${results.failed} fallidos`);

  res.json({ success: true, ...results });
});

/**
 * POST /api/v1/whatsapp/manychat/send
 * Envía la plantilla seguimiento_tesipedia + mensaje personalizado a contactos ManyChat.
 *
 * Flujo por contacto:
 *   1. Busca el lead en Supabase (si existe, usa sus datos para personalizar)
 *   2. Envía el template aprobado para abrir la ventana de 24h
 *   3. Guarda mensaje personalizado como mensaje_pendiente
 *   4. Cuando el lead responda, Sofia enviará el mensaje pendiente
 *
 * Body (opcional):
 *   - segments: ['SUPER_HOT','HOT'] → solo ciertos segmentos
 *   - maxPerRun: 50 → límite de envíos
 *   - dryRun: true → simular sin enviar
 *   - startIndex: 0 → para continuar donde se quedó
 */
export const sendManyChatReactivation = asyncHandler(async (req, res) => {
  const { segments, maxPerRun = 50, dryRun = false, startIndex = 0, excludeDuplicates = false } = req.body || {};

  console.log(`📱 ManyChat REACTIVATION iniciado — dryRun: ${!!dryRun}, max: ${maxPerRun}, startIndex: ${startIndex}`);

  // Obtener contactos
  let contacts;
  if (Array.isArray(segments) && segments.length > 0) {
    contacts = [];
    for (const seg of segments) {
      contacts.push(...getManyChatBySegment(seg));
    }
  } else {
    contacts = getManyChatContacts();
  }

  // Aplicar startIndex
  if (startIndex > 0) {
    contacts = contacts.slice(startIndex);
  }

  console.log(`📱 Contactos elegibles: ${contacts.length} (desde índice ${startIndex})`);

  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const results = [];
  const segmentStats = {};
  let sent = 0, failed = 0, skipped = 0;

  for (const contact of contacts) {
    if (sent >= maxPerRun) break;

    const wa_id = contact.wa_id.replace(/\D/g, '');

    // Inicializar stats del segmento
    if (!segmentStats[contact.segment]) segmentStats[contact.segment] = 0;

    try {
      // 1. Buscar lead en Supabase
      let existingLead = null;
      let historial = [];
      const leadResp = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=*&limit=1`,
        { headers: supabaseHeaders() }
      );

      if (leadResp.ok) {
        const leadData = await leadResp.json();
        if (leadData.length > 0) {
          existingLead = leadData[0];
          // Parse historial
          const raw = existingLead.historial_chat;
          if (Array.isArray(raw)) historial = raw;
          else if (typeof raw === 'string' && raw.trim()) {
            try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
          }
        }
      }

      // 1b. Verificar: excluir duplicados con Tesipedia (leads que ya existen con origen diferente a manychat)
      if (excludeDuplicates && existingLead && existingLead.origen && existingLead.origen !== 'manychat') {
        skipped++;
        results.push({ wa_id, nombre: existingLead.nombre, segment: contact.segment, success: false, reason: `Duplicado Tesipedia (origen: ${existingLead.origen})` });
        continue;
      }

      // 2. Verificar: no enviar si ya le mandamos reactivación ManyChat
      const lastMcReact = [...historial].reverse().find(m => m.isManyChatReactivation);
      if (lastMcReact) {
        skipped++;
        results.push({ wa_id, nombre: existingLead?.nombre || contact.nombre, segment: contact.segment, success: false, reason: 'Ya recibió reactivación ManyChat' });
        continue;
      }

      // 3. Verificar: no enviar a leads cerrados/pagados
      if (existingLead?.estado_sofia === 'cerrado') {
        skipped++;
        results.push({ wa_id, nombre: existingLead.nombre, segment: contact.segment, success: false, reason: 'Lead cerrado (ya pagó)' });
        continue;
      }

      // 4. Verificar: no enviar si bloqueado
      if (existingLead?.bloqueado) {
        skipped++;
        results.push({ wa_id, nombre: existingLead.nombre, segment: contact.segment, success: false, reason: 'Lead bloqueado' });
        continue;
      }

      // 5. Verificar: no enviar si tiene 4+ mensajes sin respuesta
      let consecutiveBot = 0;
      for (let i = historial.length - 1; i >= 0; i--) {
        if (historial[i].role === 'user') break;
        if (historial[i].role === 'assistant') consecutiveBot++;
      }
      if (consecutiveBot >= 4) {
        skipped++;
        results.push({ wa_id, nombre: existingLead?.nombre || contact.nombre, segment: contact.segment, success: false, reason: `${consecutiveBot} mensajes sin respuesta` });
        continue;
      }

      // 6. Generar mensaje personalizado
      const personalizedMsg = buildManyChatMessage(contact, existingLead);
      if (!personalizedMsg) {
        skipped++;
        results.push({ wa_id, nombre: existingLead?.nombre || contact.nombre, segment: contact.segment, success: false, reason: 'Mensaje null (lead cerrado)' });
        continue;
      }

      if (dryRun) {
        sent++;
        segmentStats[contact.segment]++;
        results.push({ wa_id, nombre: existingLead?.nombre || contact.nombre, segment: contact.segment, success: true, dryRun: true, message: personalizedMsg });
        continue;
      }

      // 7. Enviar template aprobado
      const firstName = ((existingLead?.nombre || contact.nombre || '').split(' ')[0]) || 'amigo';
      const tplBody = {
        messaging_product: 'whatsapp',
        to: wa_id,
        type: 'template',
        template: {
          name: WA_TEMPLATE_NAME,
          language: { code: WA_TEMPLATE_LANG },
          components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }],
        },
      };

      const tplResp = await fetch(waUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tplBody),
      });
      const tplData = await tplResp.json();

      if (!tplData.messages) {
        failed++;
        results.push({
          wa_id,
          nombre: existingLead?.nombre || contact.nombre,
          segment: contact.segment,
          success: false,
          reason: 'Template falló: ' + (tplData.error?.message || JSON.stringify(tplData.error || 'unknown')),
        });
        continue;
      }

      // 8. Registrar en historial
      historial.push({
        role: 'assistant',
        content: `[TEMPLATE:${WA_TEMPLATE_NAME}] Reactivación ManyChat (${contact.segment}) enviada a ${firstName}`,
        timestamp: new Date().toISOString(),
        isTemplate: true,
        isManyChatReactivation: true,
        manychatSegment: contact.segment,
      });

      // 9. Guardar/actualizar lead en Supabase
      const patchBody = {
        historial_chat: JSON.stringify(historial),
        mensaje_pendiente: JSON.stringify({
          text: personalizedMsg,
          isManyChatReactivation: true,
          manychatSegment: contact.segment,
        }),
        updated_at: new Date().toISOString(),
      };

      // Si el lead no existía, crearlo
      if (!existingLead) {
        const createBody = {
          wa_id,
          nombre: contact.nombre || '',
          estado_sofia: 'bienvenida',
          origen: 'manychat',
          manychat_segment: contact.segment,
          modo_humano: false,
          bloqueado: false,
          created_at: new Date().toISOString(),
          ...patchBody,
        };

        await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
          method: 'POST',
          headers: { ...supabaseHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify(createBody),
        });
      } else {
        // Actualizar lead existente
        if (!existingLead.origen) patchBody.origen = 'manychat';
        if (!existingLead.manychat_segment) patchBody.manychat_segment = contact.segment;

        await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify(patchBody),
        });
      }

      sent++;
      segmentStats[contact.segment]++;
      results.push({
        wa_id,
        nombre: existingLead?.nombre || contact.nombre,
        segment: contact.segment,
        success: true,
        method: 'template+queued',
        isNew: !existingLead,
        queuedMessage: personalizedMsg.substring(0, 80) + '...',
      });

      // Rate limiting: esperar 1.5s entre envíos para respetar límites de Meta
      if (!dryRun) {
        await new Promise(r => setTimeout(r, 1500));
      }

    } catch (e) {
      failed++;
      results.push({
        wa_id,
        nombre: contact.nombre,
        segment: contact.segment,
        success: false,
        reason: e.message,
      });
    }
  }

  const summary = { sent, failed, skipped, total: contacts.length, segmentStats, nextIndex: startIndex + sent + failed + skipped };
  manychatReactivation.sendResult = { ...summary, time: new Date().toISOString() };
  manychatReactivation.lastSend = new Date().toISOString();

  console.log(`📱 ManyChat reactivation: ${sent} enviados, ${failed} fallidos, ${skipped} saltados | Segments: ${JSON.stringify(segmentStats)}`);

  // Notificar al admin
  if (sent > 0 && SUPER_ADMIN_ID) {
    try {
      const app = global.__tesipediaApp;
      if (app) {
        await createNotification(app, {
          user: SUPER_ADMIN_ID,
          type: 'whatsapp',
          message: `📱 Reactivación ManyChat: ${sent} leads contactados (${Object.entries(segmentStats).map(([k,v]) => `${k}:${v}`).join(', ')})`,
          data: { segmentStats, sent },
          link: '/admin/whatsapp',
        });
      }
    } catch { /* non-critical */ }
  }

  res.json({ success: true, ...summary, results });
});

/**
 * GET /api/v1/whatsapp/manychat/status
 * Estado de la importación y reactivación ManyChat
 */
export const getManyChatStatus = asyncHandler(async (req, res) => {
  // Contar leads con origen manychat en Supabase
  let manychatLeadsCount = 0;
  try {
    const countResp = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?origen=eq.manychat&select=wa_id`,
      { headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' } }
    );
    if (countResp.ok) {
      const countHeader = countResp.headers.get('content-range');
      if (countHeader) {
        const match = countHeader.match(/\/(\d+)/);
        if (match) manychatLeadsCount = parseInt(match[1]);
      }
    }
  } catch { /* ignore */ }

  // Obtener stats por segmento
  const totalContacts = getManyChatContacts().length;
  const segmentCounts = {};
  for (const seg of SEGMENT_PRIORITY) {
    segmentCounts[seg] = getManyChatBySegment(seg).length;
  }

  res.json({
    totalContacts,
    segmentCounts,
    importedToSupabase: manychatLeadsCount,
    lastImport: manychatReactivation.lastImport,
    importResult: manychatReactivation.importResult,
    lastSend: manychatReactivation.lastSend,
    sendResult: manychatReactivation.sendResult,
  });
});

/**
 * GET /api/v1/whatsapp/manychat/preview
 * Preview de mensajes que se enviarían sin enviar nada.
 * Query: ?segment=SUPER_HOT&limit=5
 */
export const previewManyChatMessages = asyncHandler(async (req, res) => {
  const segment = req.query.segment || 'SUPER_HOT';
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);

  const contacts = getManyChatBySegment(segment).slice(0, limit);
  const previews = [];

  for (const contact of contacts) {
    const wa_id = contact.wa_id.replace(/\D/g, '');
    let existingLead = null;

    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${wa_id}&select=nombre,estado_sofia,tipo_servicio,tipo_proyecto,tema,cotizacion_enviada&limit=1`,
        { headers: supabaseHeaders() }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data.length > 0) existingLead = data[0];
      }
    } catch { /* ignore */ }

    const msg = buildManyChatMessage(contact, existingLead);

    previews.push({
      wa_id,
      nombre: existingLead?.nombre || contact.nombre,
      segment: contact.segment,
      existsInSupabase: !!existingLead,
      estadoSofia: existingLead?.estado_sofia || null,
      message: msg,
    });
  }

  res.json({ segment, count: previews.length, previews });
});

/**
 * GET /api/v1/whatsapp/manychat/leads
 * Devuelve leads ManyChat de forma inteligente:
 *   - respondieron: leads que ya contestaron (PRIORIDAD — necesitan atención)
 *   - enviados: leads a los que se les mandó reactivación pero no han respondido
 *   - pendientes: leads importados pero sin reactivación enviada
 *
 * Query: ?page=1&limit=20&filter=respondieron|enviados|pendientes|todos
 */
export const getManyChatLeadsView = asyncHandler(async (req, res) => {
  const filter = req.query.filter || 'respondieron';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  // Columnas relevantes para la vista ManyChat
  const cols = 'wa_id,nombre,estado_sofia,origen,manychat_segment,modo_humano,atendido_por,bloqueado,mensaje_pendiente,updated_at,created_at,tema,tipo_servicio,cotizacion_enviada,historial_chat';

  let queryFilter = '&origen=eq.manychat';

  if (filter === 'respondieron') {
    // Leads ManyChat que ya avanzaron de 'bienvenida' (interactuaron con Sofia)
    queryFilter += '&estado_sofia=neq.bienvenida';
  } else if (filter === 'enviados') {
    // Leads ManyChat en 'bienvenida' que ya tienen reactivación enviada (mensaje_pendiente no es null)
    queryFilter += '&estado_sofia=eq.bienvenida&mensaje_pendiente=not.is.null';
  } else if (filter === 'pendientes') {
    // Leads ManyChat en 'bienvenida' sin reactivación enviada aún
    queryFilter += '&estado_sofia=eq.bienvenida&mensaje_pendiente=is.null';
  }
  // filter === 'todos' → solo queryFilter base (origen=manychat)

  const dataUrl = `${SUPABASE_URL}/rest/v1/leads?select=${cols}${queryFilter}&order=updated_at.desc&limit=${limit}&offset=${offset}`;
  const countUrl = `${SUPABASE_URL}/rest/v1/leads?select=wa_id${queryFilter}`;

  const [dataResp, countResp] = await Promise.all([
    fetch(dataUrl, { headers: supabaseHeaders() }),
    fetch(countUrl, { headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' } }),
  ]);

  if (!dataResp.ok) {
    const err = await dataResp.text();
    res.status(dataResp.status);
    throw new Error(`Supabase error: ${err}`);
  }

  const leads = await dataResp.json();

  // Parse historial para extraer último mensaje y si el usuario respondió
  const enriched = leads.map(lead => {
    let hist = lead.historial_chat;
    if (typeof hist === 'string') {
      try { hist = JSON.parse(hist.replace(/^=/, '')); } catch { hist = []; }
    }
    if (!Array.isArray(hist)) hist = [];

    const lastUserMsg = [...hist].reverse().find(m => m.role === 'user');
    const lastBotMsg = [...hist].reverse().find(m => m.role === 'assistant');
    const totalMsgs = hist.length;
    const userMsgs = hist.filter(m => m.role === 'user').length;

    // No enviar historial completo al frontend (demasiado pesado)
    delete lead.historial_chat;

    return {
      ...lead,
      totalMsgs,
      userMsgs,
      lastUserMsg: lastUserMsg ? { content: (lastUserMsg.content || '').substring(0, 120), timestamp: lastUserMsg.timestamp } : null,
      lastBotMsg: lastBotMsg ? { content: (lastBotMsg.content || '').substring(0, 120), timestamp: lastBotMsg.timestamp } : null,
    };
  });

  // Ordenar: leads con mensajes del usuario (que respondieron) primero,
  // luego los demás, ambos grupos por updated_at desc
  enriched.sort((a, b) => {
    const aHasUser = a.userMsgs > 0 ? 1 : 0;
    const bHasUser = b.userMsgs > 0 ? 1 : 0;
    if (aHasUser !== bHasUser) return bHasUser - aHasUser;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  // Extraer count total del header
  let total = leads.length;
  if (countResp.ok) {
    const range = countResp.headers.get('content-range');
    if (range) {
      const match = range.match(/\/(\d+)/);
      if (match) total = parseInt(match[1]);
    }
  }

  // Stats rápidas (solo contar, no traer datos)
  let stats = {};
  try {
    const [respCnt, envCnt, pendCnt] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/leads?select=wa_id&origen=eq.manychat&estado_sofia=neq.bienvenida`, { headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' } }),
      fetch(`${SUPABASE_URL}/rest/v1/leads?select=wa_id&origen=eq.manychat&estado_sofia=eq.bienvenida&mensaje_pendiente=not.is.null`, { headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' } }),
      fetch(`${SUPABASE_URL}/rest/v1/leads?select=wa_id&origen=eq.manychat&estado_sofia=eq.bienvenida&mensaje_pendiente=is.null`, { headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' } }),
    ]);
    const extract = (r) => { const h = r.headers.get('content-range'); return h ? parseInt(h.match(/\/(\d+)/)?.[1] || '0') : 0; };
    stats = {
      respondieron: extract(respCnt),
      enviados: extract(envCnt),
      pendientes: extract(pendCnt),
    };
    stats.total = stats.respondieron + stats.enviados + stats.pendientes;
  } catch { /* non-critical */ }

  res.json({ filter, page, limit, total, stats, leads: enriched });
});

// ═══════════════════════════════════════════════════════
// LEADS STATS — Dashboard de análisis
// ═══════════════════════════════════════════════════════

/**
 * GET /api/v1/whatsapp/leads-stats
 * Devuelve métricas completas para el panel de informes:
 *  - conteos por estado, por admin, por origen
 *  - embudo de conversión
 *  - leads recientes (24h / 7d / 30d)
 *  - detección de problemas (leads estancados, sin atender, etc.)
 *  - precio promedio
 */
export const getLeadsStats = asyncHandler(async (req, res) => {
  const base = `${SUPABASE_URL}/rest/v1/leads`;
  const cntHdr = { ...supabaseHeaders(), 'Prefer': 'count=exact' };

  // Filtro por origen/campaña (query param ?origen=all|regular|manychat)
  const origenParam = (req.query.origen || 'all').toLowerCase();
  let origenQs = '';
  if (origenParam === 'regular') {
    origenQs = '&or=(origen.neq.manychat,origen.is.null)';
  } else if (origenParam === 'manychat') {
    origenQs = '&origen=eq.manychat';
  }

  // Helper: cuenta leads usando filtro PostgREST
  const cnt = async (qs) => {
    try {
      const r = await fetch(`${base}?select=wa_id${origenQs}${qs}`, { headers: cntHdr });
      const h = r.headers.get('content-range');
      return h ? parseInt(h.match(/\/(\d+)/)?.[1] || '0') : 0;
    } catch { return 0; }
  };

  const now = new Date();
  const h24  = new Date(now - 24  * 60 * 60 * 1000).toISOString();
  const h48  = new Date(now - 48  * 60 * 60 * 1000).toISOString();
  const h72  = new Date(now - 72  * 60 * 60 * 1000).toISOString();
  const d7   = new Date(now - 7   * 24 * 60 * 60 * 1000).toISOString();
  const d30  = new Date(now - 30  * 24 * 60 * 60 * 1000).toISOString();

  const [
    total,
    sBienvenida, sCalificando, sCotizando, sCotizacionIniciada, sCotizacionLista, sCotizacionEnviada,
    sCotizacionConfirmada, sEsperandoAprobacion, sClienteAcepto, sPagado,
    sDescartado, sNoInteresado, sModoHumano,
    bloqueados, sinAtender, conPrecio,
    regular, manychat,
    nuevos24h, nuevos7d, nuevos30d,
    admArturo, admSandy, admHugo,
    calificandoStale48h, cotizandoStale24h,
    sinAtender48h, sinAtender72h,
    cotizEnviadaSinCerrar,
  ] = await Promise.all([
    cnt(''),
    cnt('&estado_sofia=eq.bienvenida'),
    cnt('&estado_sofia=eq.calificando'),
    cnt('&estado_sofia=eq.cotizando'),
    cnt('&estado_sofia=eq.cotizacion_iniciada'),
    cnt('&estado_sofia=eq.cotizacion_lista'),
    cnt('&estado_sofia=eq.cotizacion_enviada'),
    cnt('&estado_sofia=eq.cotizacion_confirmada'),
    cnt('&estado_sofia=eq.esperando_aprobacion'),
    cnt('&estado_sofia=eq.cliente_acepto'),
    cnt('&estado_sofia=eq.pagado'),
    cnt('&estado_sofia=eq.descartado'),
    cnt('&estado_sofia=eq.no_interesado'),
    cnt('&modo_humano=eq.true&estado_sofia=neq.descartado'),
    cnt('&bloqueado=eq.true'),
    cnt('&atendido_por=is.null&estado_sofia=neq.descartado&bloqueado=neq.true'),
    cnt('&precio=gt.0'),
    cnt('&or=(origen.neq.manychat,origen.is.null)'),
    cnt('&origen=eq.manychat'),
    cnt(`&created_at=gte.${h24}`),
    cnt(`&created_at=gte.${d7}`),
    cnt(`&created_at=gte.${d30}`),
    cnt('&atendido_por=ilike.*arturo*'),
    cnt('&atendido_por=ilike.*sandy*'),
    cnt('&atendido_por=ilike.*hugo*'),
    // Problemas: leads estancados
    cnt(`&estado_sofia=eq.calificando&updated_at=lt.${h48}&modo_humano=eq.false&bloqueado=neq.true`),
    cnt(`&estado_sofia=eq.cotizando&updated_at=lt.${h24}&modo_humano=eq.false&bloqueado=neq.true`),
    cnt(`&atendido_por=is.null&created_at=lt.${h48}&estado_sofia=neq.descartado&bloqueado=neq.true`),
    cnt(`&atendido_por=is.null&created_at=lt.${h72}&estado_sofia=neq.descartado&bloqueado=neq.true`),
    cnt('&estado_sofia=eq.cotizacion_enviada&precio=gt.0'),
  ]);

  // Precio promedio (sólo leads con precio)
  let precioPromedio = 0;
  let precioMin = 0;
  let precioMax = 0;
  try {
    const r = await fetch(`${base}?select=precio&precio=gt.0&limit=500`, { headers: supabaseHeaders() });
    if (r.ok) {
      const rows = await r.json();
      if (rows.length > 0) {
        const precios = rows.map(p => p.precio || 0).filter(p => p > 0);
        precioPromedio = Math.round(precios.reduce((s, p) => s + p, 0) / precios.length);
        precioMin = Math.min(...precios);
        precioMax = Math.max(...precios);
      }
    }
  } catch { /* non-critical */ }

  // Tasa de conversión: leads que llegaron a cotizacion_enviada / total activos
  const totalActivos = total - sDescartado - bloqueados;
  const tasaConversion = totalActivos > 0 ? Math.round((sCotizacionEnviada / totalActivos) * 100) : 0;
  const tasaCalificacion = totalActivos > 0 ? Math.round(((sCalificando + sCotizando + sCotizacionEnviada) / totalActivos) * 100) : 0;

  // Lista de problemas detectados (severidad: alta/media/baja)
  const problemas = [];
  if (sinAtender72h > 0)
    problemas.push({ id: 'sin_atender_72h', severidad: 'alta', titulo: 'Leads sin atender >72h', descripcion: `${sinAtender72h} lead${sinAtender72h > 1 ? 's' : ''} llevan más de 3 días sin que ningún admin los atienda.`, count: sinAtender72h });
  if (sinAtender48h > sinAtender72h)
    problemas.push({ id: 'sin_atender_48h', severidad: 'media', titulo: 'Leads sin atender >48h', descripcion: `${sinAtender48h - sinAtender72h} lead${(sinAtender48h - sinAtender72h) > 1 ? 's' : ''} sin atender entre 48h y 72h.`, count: sinAtender48h - sinAtender72h });
  if (calificandoStale48h > 0)
    problemas.push({ id: 'calificando_estancado', severidad: 'media', titulo: 'Leads estancados en calificación', descripcion: `${calificandoStale48h} lead${calificandoStale48h > 1 ? 's' : ''} llevan más de 48h en etapa "calificando" sin avanzar.`, count: calificandoStale48h });
  if (cotizandoStale24h > 0)
    problemas.push({ id: 'cotizando_estancado', severidad: 'alta', titulo: 'Leads estancados en cotización', descripcion: `${cotizandoStale24h} lead${cotizandoStale24h > 1 ? 's' : ''} llevan más de 24h esperando cotización sin respuesta.`, count: cotizandoStale24h });
  if (sCotizacionLista > 0)
    problemas.push({ id: 'cotizacion_sin_enviar', severidad: 'alta', titulo: 'Cotizaciones listas sin enviar', descripcion: `${sCotizacionLista} cotización${sCotizacionLista > 1 ? 'es están' : ' está'} lista${sCotizacionLista > 1 ? 's' : ''} pero no se ha${sCotizacionLista > 1 ? 'n' : ''} enviado al cliente.`, count: sCotizacionLista });
  if (sinAtender > 5)
    problemas.push({ id: 'alto_sin_atender', severidad: 'media', titulo: 'Alto volumen sin atender', descripcion: `${sinAtender} leads activos aún no tienen un admin asignado.`, count: sinAtender });

  res.json({
    general: { total, bloqueados, sinAtender, conPrecio, precioPromedio, precioMin, precioMax, regular, manychat, tasaConversion, tasaCalificacion },
    porEstado: {
      bienvenida: sBienvenida, calificando: sCalificando, cotizando: sCotizando,
      cotizacion_iniciada: sCotizacionIniciada, cotizacion_lista: sCotizacionLista,
      cotizacion_enviada: sCotizacionEnviada, cotizacion_confirmada: sCotizacionConfirmada,
      esperando_aprobacion: sEsperandoAprobacion, cliente_acepto: sClienteAcepto,
      pagado: sPagado, descartado: sDescartado, no_interesado: sNoInteresado,
      modo_humano: sModoHumano,
    },
    porAdmin: { arturo: admArturo, sandy: admSandy, hugo: admHugo, sinAtender },
    recientes: { h24: nuevos24h, d7: nuevos7d, d30: nuevos30d },
    problemas: { calificandoStale48h, cotizandoStale24h, sinAtender48h, sinAtender72h, cotizEnviadaSinCerrar },
    alertas: problemas,
    embudo: [
      { etapa: 'Nuevos (Bienvenida)', value: sBienvenida, color: '#6b7280' },
      { etapa: 'Calificando', value: sCalificando, color: '#f59e0b' },
      { etapa: 'Cotizando', value: sCotizando, color: '#3b82f6' },
      { etapa: 'Cotización iniciada', value: sCotizacionIniciada, color: '#8b5cf6' },
      { etapa: 'Cotización lista', value: sCotizacionLista, color: '#6366f1' },
      { etapa: 'Cotización enviada', value: sCotizacionEnviada, color: '#10b981' },
      { etapa: 'Cotización confirmada', value: sCotizacionConfirmada, color: '#059669' },
      { etapa: 'Esperando aprobación', value: sEsperandoAprobacion, color: '#d97706' },
      { etapa: 'Cliente aceptó', value: sClienteAcepto, color: '#16a34a' },
      { etapa: 'Pagado', value: sPagado, color: '#15803d' },
    ],
    perdidos: [
      { etapa: 'Descartado', value: sDescartado, color: '#ef4444' },
      { etapa: 'No interesado', value: sNoInteresado, color: '#dc2626' },
    ],
  });
});

// ═══════════════════════════════════════════════════════
// CALIFICACIÓN FOLLOW-UP — Seguimiento a leads en calificando/cotizando
// ═══════════════════════════════════════════════════════

// Construye mensaje personalizado según el estado y los campos faltantes
function buildCalificacionFollowUpMessage(lead) {
  const nombre = (lead.nombre || '').split(' ')[0];
  const sal = nombre ? `Hola ${nombre}` : 'Hola';

  if (lead.estado_sofia === 'calificando') {
    if (!lead.tipo_servicio)
      return `${sal} 👋 Soy Sofía de Tesipedia. ¿En qué te puedo ayudar hoy? Cuéntame sobre tu proyecto académico.`;
    if (!lead.nivel)
      return `${sal}, ¿me puedes decir qué nivel académico tiene tu trabajo? (licenciatura, maestría, doctorado…)`;
    if (!lead.carrera)
      return `${sal}, ¿cuál es tu carrera o área de estudio?`;
    if (!lead.tema)
      return `${sal}, ¿ya tienes definido el tema de tu proyecto? Si no, podemos ayudarte a elegirlo 😊`;
    if (!lead.paginas)
      return `${sal}, ¿aproximadamente cuántas páginas necesitas? Con eso te puedo dar un precio exacto.`;
    if (!lead.fecha_entrega)
      return `${sal}, ¿para cuándo necesitas tener listo tu proyecto? Así te digo si tenemos disponibilidad.`;
    return `${sal}, ya casi tenemos toda la información para tu cotización. ¿Hay algo más que quieras agregar o alguna duda?`;
  }

  if (lead.estado_sofia === 'cotizando') {
    const serv = lead.tipo_servicio === 'servicio_2' ? 'correcciones' : lead.tipo_servicio === 'servicio_3' ? 'asesoría' : 'redacción completa';
    const proy = lead.tipo_proyecto === 'proyecto_1' ? 'tesis' : lead.tipo_proyecto === 'proyecto_2' ? 'tesina' : 'proyecto';
    const temaStr = lead.tema ? ` sobre "${lead.tema}"` : '';
    return `${sal} 📋 Estoy preparando tu cotización para la ${serv} de tu ${proy}${temaStr}. ¿Tienes alguna pregunta o quieres ajustar algo antes de que te la envíe?`;
  }

  return `${sal}, ¿cómo va tu proyecto académico? Estoy aquí para ayudarte 😊`;
}

const calificacionFollowUp = {
  active: false,
  intervalMinutes: 480,   // cada 8 horas
  staleMinutes: 120,      // leads sin actividad por más de 2 horas
  maxPerRun: 30,
  lastRun: null,
  lastResult: null,
  _timer: null,
};

async function runCalificacionFollowUp() {
  const ADMIN_IDS = ['5215583352096', '525561757123', '525512478395', '5215541004180', '5215561757123'];
  const since = new Date(Date.now() - calificacionFollowUp.staleMinutes * 60 * 1000).toISOString();

  try {
    const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${since}&estado_sofia=in.(calificando,cotizando)&modo_humano=eq.false&bloqueado=neq.true&select=wa_id,nombre,estado_sofia,updated_at,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega&order=updated_at.asc&limit=${calificacionFollowUp.maxPerRun}`;
    const resp = await fetch(url, { headers: supabaseHeaders() });
    if (!resp.ok) {
      calificacionFollowUp.lastResult = { error: 'Supabase error ' + resp.status, time: new Date().toISOString() };
      return;
    }
    const allLeads = await resp.json();
    const leads = allLeads.filter(l => !ADMIN_IDS.includes(l.wa_id));

    if (leads.length === 0) {
      calificacionFollowUp.lastRun = new Date().toISOString();
      calificacionFollowUp.lastResult = { sent: 0, failed: 0, total: 0, skipped: 0, time: new Date().toISOString() };
      return;
    }

    const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
    let sent = 0, failed = 0, skipped = 0;

    for (const lead of leads) {
      // Verificar historial: no enviar si ya hay 2+ follow-ups sin respuesta
      let historial = [];
      try {
        const histResp = await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}&select=historial_chat&limit=1`, { headers: supabaseHeaders() });
        if (histResp.ok) {
          const histData = await histResp.json();
          const raw = histData[0]?.historial_chat;
          if (Array.isArray(raw)) historial = raw;
          else if (typeof raw === 'string' && raw.trim()) {
            try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
          }
        }
      } catch { /* continuar sin historial */ }

      let consecutiveFollowUps = 0;
      for (let i = historial.length - 1; i >= 0; i--) {
        const m = historial[i];
        if (m.role === 'user') break;
        if (m.isCalificacionFollowUp || m.isReengagement) consecutiveFollowUps++;
      }

      if (consecutiveFollowUps >= 2) {
        skipped++;
        continue;
      }

      const msg = buildCalificacionFollowUpMessage(lead);
      const cleanNumber = lead.wa_id.replace(/\D/g, '');

      try {
        const waResp = await fetch(waUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: cleanNumber, type: 'text', text: { body: msg } }),
        });
        const waData = await waResp.json();

        if (waData.messages) {
          sent++;
          historial.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString(), isCalificacionFollowUp: true });
          await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${lead.wa_id}`, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({ historial_chat: JSON.stringify(historial), updated_at: new Date().toISOString() }),
          });
        } else {
          failed++;
        }
      } catch { failed++; }
    }

    calificacionFollowUp.lastRun = new Date().toISOString();
    calificacionFollowUp.lastResult = { sent, failed, skipped, total: leads.length, time: new Date().toISOString() };
    console.log(`📋 Calificación Follow-Up: ${sent} enviados, ${failed} fallidos, ${skipped} omitidos de ${leads.length}`);
  } catch (e) {
    console.error('Calificación Follow-Up error:', e.message);
    calificacionFollowUp.lastResult = { error: e.message, time: new Date().toISOString() };
  }
}

function startCalificacionFollowUp() {
  if (calificacionFollowUp._timer) clearInterval(calificacionFollowUp._timer);
  calificacionFollowUp.active = true;
  calificacionFollowUp._timer = setInterval(runCalificacionFollowUp, calificacionFollowUp.intervalMinutes * 60 * 1000);
  console.log(`📋 Calificación Follow-Up ACTIVADO — cada ${calificacionFollowUp.intervalMinutes} min`);
}

function stopCalificacionFollowUp() {
  if (calificacionFollowUp._timer) clearInterval(calificacionFollowUp._timer);
  calificacionFollowUp._timer = null;
  calificacionFollowUp.active = false;
  console.log('📋 Calificación Follow-Up DESACTIVADO');
}

export const getCalificacionFollowUpStatus = asyncHandler(async (req, res) => {
  res.json({
    active: calificacionFollowUp.active,
    intervalMinutes: calificacionFollowUp.intervalMinutes,
    staleMinutes: calificacionFollowUp.staleMinutes,
    maxPerRun: calificacionFollowUp.maxPerRun,
    lastRun: calificacionFollowUp.lastRun,
    lastResult: calificacionFollowUp.lastResult,
  });
});

export const configCalificacionFollowUp = asyncHandler(async (req, res) => {
  const { active, intervalMinutes, staleMinutes, maxPerRun } = req.body;
  if (intervalMinutes !== undefined) calificacionFollowUp.intervalMinutes = Math.max(30, Number(intervalMinutes) || 480);
  if (staleMinutes !== undefined) calificacionFollowUp.staleMinutes = Math.max(30, Number(staleMinutes) || 120);
  if (maxPerRun !== undefined) calificacionFollowUp.maxPerRun = Math.max(1, Math.min(100, Number(maxPerRun) || 30));

  if (active === true) startCalificacionFollowUp();
  else if (active === false) stopCalificacionFollowUp();
  else if (calificacionFollowUp.active) startCalificacionFollowUp();

  res.json({
    active: calificacionFollowUp.active,
    intervalMinutes: calificacionFollowUp.intervalMinutes,
    staleMinutes: calificacionFollowUp.staleMinutes,
    maxPerRun: calificacionFollowUp.maxPerRun,
  });
});

export const runCalificacionFollowUpManual = asyncHandler(async (req, res) => {
  const { dryRun, maxPerRun: mr } = req.body || {};
  if (mr) calificacionFollowUp.maxPerRun = Math.max(1, Math.min(100, Number(mr) || 30));
  console.log(`📋 Calificación Follow-Up MANUAL por ${req.user?.nombre || 'admin'} — dryRun: ${!!dryRun}`);
  if (dryRun) {
    const since = new Date(Date.now() - calificacionFollowUp.staleMinutes * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${since}&estado_sofia=in.(calificando,cotizando)&modo_humano=eq.false&bloqueado=neq.true&select=wa_id,nombre,estado_sofia,updated_at&order=updated_at.asc&limit=${calificacionFollowUp.maxPerRun}`;
    const resp = await fetch(url, { headers: supabaseHeaders() });
    const leads = resp.ok ? await resp.json() : [];
    return res.json({ dryRun: true, would_send: leads.length, leads: leads.map(l => ({ wa_id: l.wa_id, nombre: l.nombre, estado: l.estado_sofia, updated_at: l.updated_at })) });
  }
  await runCalificacionFollowUp();
  res.json({ success: true, result: calificacionFollowUp.lastResult });
});

// Auto-iniciar al cargar el modulo — Sofia corre cada 6h desde el arranque del server
startAutoReminder();

// Auto-revival inicia también al arrancar (cada 24h por defecto)
startAutoRevival();

// Quote follow-up inicia al arrancar (cada 12h por defecto)
startQuoteFollowUp();
