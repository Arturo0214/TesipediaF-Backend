import CotizarLead from '../models/CotizarLead.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const supaHeaders = () => ({
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates,return=representation',
});

/**
 * POST /cotizar-leads
 * Guarda un lead del formulario de /cotizar (público, sin auth)
 * También lo crea en Supabase para que aparezca en el panel de WhatsApp
 */
export const createCotizarLead = async (req, res) => {
  try {
    const {
      nombre, telefono, telefono_e164, carrera, nivel_estudios,
      tipo_proyecto, num_paginas, fecha_entrega, source, page,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, referrer,
    } = req.body;

    // Validación básica
    if (!nombre || !telefono || !carrera || !nivel_estudios || !tipo_proyecto) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios: nombre, telefono, carrera, nivel_estudios, tipo_proyecto'
      });
    }

    // Guardar en MongoDB
    const lead = await CotizarLead.create({
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      telefono_e164: telefono_e164 || '',
      carrera: carrera.trim(),
      nivel_estudios,
      tipo_proyecto,
      num_paginas: num_paginas ? Number(num_paginas) : undefined,
      fecha_entrega: fecha_entrega || '',
      source: source || 'direct',
      page: page || '/cotizar',
      utm_source: utm_source || '',
      utm_medium: utm_medium || '',
      utm_campaign: utm_campaign || '',
      utm_content: utm_content || '',
      utm_term: utm_term || '',
      fbclid: fbclid || '',
      gclid: gclid || '',
      referrer: referrer || '',
    });

    // ── CREAR LEAD EN SUPABASE (aparece en panel de WhatsApp) ──
    const rawTel = telefono.replace(/\D/g, '');
    const wa_id = rawTel.startsWith('521') ? rawTel
      : rawTel.startsWith('52') ? '521' + rawTel.slice(2)
      : '521' + rawTel.slice(-10);

    const resumen = `[Formulario web] ${nombre.trim()} — ${tipo_proyecto}, ${carrera.trim()}, ${nivel_estudios}, ${num_paginas || '?'} págs, entrega: ${fecha_entrega || 'no especificada'}`;
    const supaLead = {
      wa_id,
      nombre: nombre.trim(),
      carrera: carrera.trim(),
      nivel: nivel_estudios,
      tipo_servicio: 'Redacción completa',
      tipo_proyecto,
      paginas: String(num_paginas || ''),
      fecha_entrega: fecha_entrega || '',
      estado_sofia: 'esperando_aprobacion',
      origen: 'formulario_web',
      historial_chat: JSON.stringify([{
        role: 'user',
        content: resumen,
        timestamp: new Date().toISOString(),
      }]),
      updated_at: new Date().toISOString(),
      mensajes_sin_leer: 1,
      ultimo_mensaje_preview: `👤 ${nombre.trim()}: ${tipo_proyecto} - ${carrera.trim()}`,
    };

    try {
      const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST',
        headers: supaHeaders(),
        body: JSON.stringify(supaLead),
      });
      if (supaRes.ok) {
        lead.supabase_synced = true;
        console.log(`✅ Cotizar lead ${nombre} → Supabase (${wa_id})`);
      } else {
        const errText = await supaRes.text();
        lead.supabase_error = `HTTP ${supaRes.status}: ${errText.slice(0, 200)}`;
        console.warn(`⚠️ Cotizar lead Supabase error: ${lead.supabase_error}`);
      }
    } catch (supaErr) {
      lead.supabase_error = supaErr.message;
      console.warn(`⚠️ Cotizar lead Supabase exception: ${supaErr.message}`);
    }

    // Intentar enviar al webhook de n8n como respaldo (no bloquea la respuesta)
    const webhookUrl = process.env.WEBHOOK_COTIZAR_URL;
    if (webhookUrl) {
      try {
        const webhookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...req.body,
            timestamp: new Date().toISOString(),
            _mongoId: lead._id.toString()
          }),
          signal: AbortSignal.timeout(5000) // 5s timeout
        });

        lead.webhook_sent = webhookRes.ok;
        if (!webhookRes.ok) {
          lead.webhook_error = `HTTP ${webhookRes.status}`;
        }
      } catch (whErr) {
        lead.webhook_sent = false;
        lead.webhook_error = whErr.message;
      }
    }
    await lead.save();

    res.status(201).json({
      success: true,
      message: 'Lead guardado correctamente',
      data: { id: lead._id }
    });
  } catch (error) {
    console.error('Error creando cotizar lead:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno al guardar el lead'
    });
  }
};

/**
 * GET /cotizar-leads
 * Lista todos los leads (protegido, solo admin)
 */
export const getCotizarLeads = async (req, res) => {
  try {
    const { estado, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (estado) filter.estado = estado;

    const leads = await CotizarLead.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await CotizarLead.countDocuments(filter);

    res.json({
      success: true,
      data: leads,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error obteniendo cotizar leads:', error);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
};

/**
 * PATCH /cotizar-leads/:id
 * Actualiza estado/notas de un lead (protegido, solo admin)
 */
export const updateCotizarLead = async (req, res) => {
  try {
    const { estado, notas } = req.body;
    const update = {};
    if (estado) update.estado = estado;
    if (notas !== undefined) update.notas = notas;

    const lead = await CotizarLead.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    res.json({ success: true, data: lead });
  } catch (error) {
    console.error('Error actualizando cotizar lead:', error);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
};
