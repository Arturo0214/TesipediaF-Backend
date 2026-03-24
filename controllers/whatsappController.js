/**
 * WhatsApp Controller — Panel de administración
 * Conecta con Supabase (leads) y WhatsApp Business API
 */

import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const WA_PHONE_ID = process.env.WA_PHONE_ID || '978427788691495';
const WA_TOKEN = process.env.WA_TOKEN || '';

// Plantilla aprobada para enviar fuera de la ventana de 24h
const WA_TEMPLATE_NAME = 'seguimiento_tesipedia';
const WA_TEMPLATE_LANG = 'es_MX';
const HOURS_24 = 24 * 60 * 60 * 1000;

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
    return `${saludo} Veo que estas trabajando en ${proyectoLabel.toLowerCase() === 'otro' ? 'tu proyecto' : 'tu ' + proyectoLabel.toLowerCase()}. De que nivel academico es? Licenciatura, maestria o doctorado?`;
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
  const url = `${SUPABASE_URL}/rest/v1/leads?select=id,wa_id,nombre,email,telefono,estado_sofia,modo_humano,atendido_por,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega,created_at,updated_at,mensaje_pendiente&order=updated_at.desc&limit=100`;
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
 * GET /api/v1/whatsapp/leads/:waId
 * Obtener un lead por wa_id
 */
export const getLeadByWaId = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const url = `${SUPABASE_URL}/rest/v1/leads?wa_id=eq.${waId}&limit=1`;
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
  const url = `${SUPABASE_URL}/rest/v1/leads?select=wa_id,nombre,estado_sofia,updated_at`;
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
    const fileBuffer = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    
    const uploadOptions = {
      folder: 'whatsapp_admin_media',
      resource_type: isDoc ? 'raw' : 'auto',
    };

    // Si es un documento, subimos como 'raw' y le damos un public_id que incluya su extensión
    if (isDoc) {
      const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : 'pdf';
      uploadOptions.public_id = `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    }

    const result = await cloudinary.uploader.upload(fileBuffer, uploadOptions);
    
    mediaUrl = result.secure_url;
    mimetype = file.mimetype;
    filename = file.originalname;
    mediaType = isDoc ? 'document' : 'image';
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
    };
    // Solo asignar dueño si el lead no tiene uno
    if (!leadAtendidoPor) {
      patchBody.atendido_por = adminName.toLowerCase();
    }
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify(patchBody),
    });

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
  };
  if (!leadAtendidoPor) {
    patchBody.atendido_por = adminName.toLowerCase();
  }
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(patchBody),
  });

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
  const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=gte.${since}&estado_sofia=in.(bienvenida,calificando,cotizando)&modo_humano=eq.false&select=wa_id,nombre,estado_sofia,updated_at,historial_chat,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega`;
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

  // 3. Enviar mensaje de Sofia a cada lead
  const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
  const results = [];

  for (const lead of stuckLeads) {
    const cleanNumber = lead.wa_id.replace(/\D/g, '');
    const msg = buildSofiaContextualMessage(lead);

    try {
      const payload = {
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'text',
        text: { body: msg },
      };

      const waResp = await fetch(waUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const waData = await waResp.json();
      const success = !!waData.messages;

      if (success) {
        // Actualizar historial del lead
        let historial = [];
        const raw = lead.historial_chat;
        if (Array.isArray(raw)) historial = raw;
        else if (typeof raw === 'string' && raw.trim()) {
          try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
        }

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
  const failed = results.filter(r => !r.success).length;
  console.log(`📣 Sofia Recordatorio: ${sent} enviados, ${failed} fallidos de ${stuckLeads.length} leads (ventana: ${hours}h)`);

  res.json({ success: true, sent, failed, total: stuckLeads.length, results });
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
    const url = `${SUPABASE_URL}/rest/v1/leads?updated_at=lt.${since}&estado_sofia=in.(bienvenida,calificando,cotizando)&modo_humano=eq.false&select=wa_id,nombre,estado_sofia,updated_at,historial_chat,tipo_servicio,tipo_proyecto,nivel,carrera,tema,paginas,fecha_entrega&order=updated_at.asc&limit=${autoReminder.maxPerRun}`;
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
      autoReminder.lastResult = { sent: 0, failed: 0, total: 0, time: new Date().toISOString() };
      console.log('🤖 Auto-reminder: 0 leads estancados');
      return;
    }

    const waUrl = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`;
    let sent = 0, failed = 0;

    for (const lead of leads) {
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

          // Actualizar historial
          let historial = [];
          const raw = lead.historial_chat;
          if (Array.isArray(raw)) historial = raw;
          else if (typeof raw === 'string' && raw.trim()) {
            try { historial = JSON.parse(raw.replace(/^=/, '')); } catch { historial = []; }
          }
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
    autoReminder.lastResult = { sent, failed, total: leads.length, time: new Date().toISOString() };
    console.log(`🤖 Auto-reminder: ${sent} enviados, ${failed} fallidos de ${leads.length} leads`);
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

// Auto-iniciar al cargar el modulo — Sofia corre cada 6h desde el arranque del server
startAutoReminder();
