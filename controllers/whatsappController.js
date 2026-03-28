/**
 * WhatsApp Controller — Panel de administración
 * Conecta con Supabase (leads) y WhatsApp Business API
 */

import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';
import createNotification from '../utils/createNotification.js';

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
  // 1. Traer metadata de TODOS los leads (sin historial_chat) — ~50-100 KB
  // 2. Traer historial_chat SOLO de los 40 leads más recientes — para preview
  // Resultado: ~80-90% menos egress vs traer todo, con previews funcionales.

  const metaColumns = [
    'wa_id', 'nombre', 'etapa', 'precio', 'datos_cotizacion',
    'created_at', 'updated_at', 'estado_sofia', 'paso_sofia',
    'carrera', 'nivel', 'tipo_servicio', 'tipo_proyecto',
    'paginas', 'paginas_avance', 'tipo_trabajo', 'fecha_entrega',
    'tiene_tema', 'tiene_avance', 'boton_actual', 'control_humano',
    'motivo_intervencion', 'cotizacion_aprobada', 'cotizacion_enviada',
    'tema', 'pdf_url', 'modo_humano', 'atendido_por',
    'mensaje_pendiente', 'ultimo_mensaje_at', 'bloqueado',
  ].join(',');

  // Query 1: metadata de todos los leads
  const metaUrl = `${SUPABASE_URL}/rest/v1/leads?select=${metaColumns}&order=updated_at.desc`;
  // Query 2: historial solo de los 40 leads más recientes (para preview)
  const previewUrl = `${SUPABASE_URL}/rest/v1/leads?select=wa_id,historial_chat&order=updated_at.desc&limit=40`;

  const [metaResp, previewResp] = await Promise.all([
    fetch(metaUrl, { headers: supabaseHeaders() }),
    fetch(previewUrl, { headers: supabaseHeaders() }),
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
    }
    return lead;
  });

  res.json(enriched);
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

  if (file) {
    const isDoc = !!file.mimetype.match(/pdf|msword|officedocument|csv|text/i);
    const isAudio = !!file.mimetype.match(/audio|ogg|opus|mp3|mpeg|wav|webm|aac/i);

    // Limpiar MIME type: quitar parámetros como "; codecs=opus" que rompen el data URI
    const cleanMimetype = file.mimetype.split(';')[0].trim();
    const fileBuffer = `data:${cleanMimetype};base64,${file.buffer.toString('base64')}`;

    const uploadOptions = {
      folder: 'whatsapp_admin_media',
      resource_type: isDoc ? 'raw' : isAudio ? 'video' : 'auto',
    };

    // Si es un documento, subimos como 'raw' con extensión
    if (isDoc) {
      const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : 'pdf';
      uploadOptions.public_id = `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    } else if (isAudio) {
      // Audio se sube como 'video' (Cloudinary trata audio como subconjunto de video)
      // Esto permite transformaciones de formato y sirve content-type correcto
      uploadOptions.public_id = `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      uploadOptions.format = 'ogg'; // Convertir a OGG (formato soportado por WhatsApp API)
    }

    console.log(`📤 Subiendo archivo a Cloudinary: type=${cleanMimetype}, size=${file.buffer.length}, resource_type=${uploadOptions.resource_type}, isAudio=${isAudio}`);

    let result;
    try {
      result = await cloudinary.uploader.upload(fileBuffer, uploadOptions);
    } catch (uploadErr) {
      console.error('❌ Cloudinary upload error:', uploadErr.message || uploadErr);
      throw new Error(`Error al subir archivo a Cloudinary: ${uploadErr.message}`);
    }

    // Para audio: asegurar que la URL use extensión .ogg para WhatsApp
    let finalUrl = result.secure_url;
    if (isAudio && finalUrl && !finalUrl.endsWith('.ogg')) {
      // Reemplazar la extensión del archivo en la URL de Cloudinary
      finalUrl = finalUrl.replace(/\.[^.]+$/, '.ogg');
    }

    mediaUrl = finalUrl;
    mimetype = isAudio ? 'audio/ogg' : file.mimetype;
    filename = isAudio ? file.originalname.replace(/\.[^.]+$/, '.ogg') : file.originalname;
    mediaType = isAudio ? 'audio' : (isDoc ? 'document' : 'image');
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

    // Guardar historial + mensaje pendiente en campo separado para que n8n lo detecte
    const mensajePendiente = {
      mensaje: mensaje || '',
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      mimetype: mimetype || null,
      filename: filename || null,
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
    payload[mediaType] = { link: mediaUrl };
    if (mensaje) payload[mediaType].caption = mensaje;
    if (mediaType === 'document' && filename) payload.document.filename = filename;
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
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=gte.${since}&estado_sofia=in.(bienvenida,calificando,cotizando)&modo_humano=eq.false&select=wa_id,nombre,estado_sofia,updated_at,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    res.status(500);
    throw new Error('Error al consultar leads en Supabase');
  }
  const allLeads = await response.json();

  // 2. Filtrar admins
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
    return `${saludo}, te escribe Sofia de Tesipedia! Ha pasado una semana y queria saber si puedo ayudarte con algo. Tenemos disponibilidad esta semana y asesoria sin compromiso. Me cuentas?`;
  }

  // ═══════════════════════════════
  // TIER 14 DÍAS — Oferta especial, más directo
  // ═══════════════════════════════
  if (tier === 14) {
    if (estado === 'bienvenida') {
      return `${saludo}, soy Sofia de Tesipedia! Han pasado dos semanas y se que el semestre avanza rapido. No dejes tu proyecto academico para el final: tenemos un 10% de descuento especial para quienes retoman su cotizacion esta semana. Te interesa saber mas?`;
    }
    if (estado === 'calificando') {
      return `${saludo}, soy Sofia de Tesipedia! Tu ${tieneProyecto ? proyectoLabel : 'proyecto'}${tieneTema ? ` sobre "${lead.tema}"` : ''} sigue en nuestro sistema y no quiero que pierdas la oportunidad. Esta quincena tenemos un descuento del 10% para retomar proyectos. Quieres que completemos tu cotizacion?`;
    }
    if (estado === 'cotizando') {
      return `${saludo}, soy Sofia de Tesipedia! Tu cotizacion${tieneTema ? ` para "${lead.tema}"` : ''} ya tiene dos semanas esperandote. Para motivarte a decidir, tenemos un 10% de descuento si confirmas esta semana. Te la reenvio con el precio especial?`;
    }
    if (estado === 'descartado') {
      return `${saludo}, soy Sofia de Tesipedia! Se que ha pasado tiempo, pero queria ofrecerte algo especial: 10% de descuento en cualquiera de nuestros servicios si retomas tu proyecto esta semana. ${tieneTema ? `Tu tema "${lead.tema}" suena muy interesante y me encantaria ayudarte.` : 'Me encantaria ayudarte con tu proyecto academico.'} Que dices?`;
    }
    return `${saludo}, te escribe Sofia de Tesipedia! Ya pasaron dos semanas y tenemos una promocion especial: 10% de descuento para proyectos que se retomen esta semana. Te interesa?`;
  }

  // ═══════════════════════════════
  // TIER 30 DÍAS — Último intento, "te extrañamos"
  // ═══════════════════════════════
  if (tier >= 30) {
    if (estado === 'bienvenida' || estado === 'descartado') {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Ha pasado un buen tiempo y queria escribirte por ultima vez. Si en algun momento necesitas apoyo con tu tesis o proyecto academico, aqui seguimos. Nuestro equipo tiene experiencia en mas de 500 proyectos y nos encantaria ayudarte. Solo responde este mensaje y retomamos. Exito en todo!`;
    }
    if (estado === 'calificando') {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Ya paso un mes y tu ${tieneProyecto ? proyectoLabel : 'proyecto'}${tieneTema ? ` sobre "${lead.tema}"` : ''} sigue registrado con nosotros. Este es mi ultimo mensaje, pero si decides retomar, solo responde y te atendemos de inmediato. Nuestro equipo ha ayudado a mas de 500 estudiantes a graduarse. Mucho exito!`;
    }
    if (estado === 'cotizando') {
      return `${saludo}, soy Sofia de Tesipedia! 🎓 Tu cotizacion${tieneTema ? ` para "${lead.tema}"` : ''} vencio, pero puedo generarte una nueva al instante si la necesitas. Este es mi ultimo seguimiento: si decides avanzar con tu proyecto, solo responde y retomamos donde nos quedamos. Te deseo mucho exito!`;
    }
    return `${saludo}, te escribe Sofia de Tesipedia! 🎓 Ha pasado bastante tiempo. Este es mi ultimo mensaje de seguimiento, pero si algun dia necesitas apoyo academico, aqui estaremos. Solo responde y te atendemos. Mucho exito en todo!`;
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

  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${threeDaysAgo}&bloqueado=neq.true&select=wa_id,nombre,estado_sofia,updated_at,created_at,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega,modo_humano&order=updated_at.asc&limit=500`;

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
 * Body: { wa_id, nombre, mensaje, is_new_lead? }
 */
export const incomingMessageWebhook = asyncHandler(async (req, res) => {
  const { wa_id, nombre, mensaje, is_new_lead } = req.body;
  if (!wa_id) return res.status(400).json({ error: 'wa_id requerido' });

  const displayName = nombre || `+${wa_id}`;
  const preview = mensaje ? (mensaje.length > 80 ? mensaje.substring(0, 80) + '...' : mensaje) : '(mensaje)';

  if (SUPER_ADMIN_ID) {
    // Notificación de mensaje nuevo de WhatsApp
    await createNotification(req.app, {
      user: SUPER_ADMIN_ID,
      type: 'whatsapp',
      message: `💬 ${displayName}: ${preview}`,
      data: { wa_id, nombre: displayName },
      link: '/admin/whatsapp',
      priority: 'medium',
    });

    // Si es un lead completamente nuevo, notificar aparte
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

  res.json({ ok: true });
});

// Auto-iniciar al cargar el modulo — Sofia corre cada 6h desde el arranque del server
startAutoReminder();

// Auto-revival inicia también al arrancar (cada 24h por defecto)
startAutoRevival();
