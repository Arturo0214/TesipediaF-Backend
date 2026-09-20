import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
import GeneratedQuote from '../models/GeneratedQuote.js';
import Project from '../models/Project.js';
import Seguimiento from '../models/Seguimiento.js';
import Notification from '../models/Notification.js';
import cloudinary from '../config/cloudinary.js';
import supabaseAdmin from '../config/supabaseAdmin.js';
import createNotification from '../utils/createNotification.js';
import { buildInstallments, normalizeEsquema } from '../utils/quoteSchedule.js';

/* ─────────────── helpers ─────────────── */
const VALID_TYPES = ['quote', 'payment', 'project'];

const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const DAY = 24 * 60 * 60 * 1000;
const diasDesde = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : null);

// Concilia las parcialidades de una cotización pagada — MISMA lógica que Revenue/Pagos.
function reconcile(q) {
  const total = q.precioConDescuento || q.precioConRecargo || q.precioBase || 0;
  const insts = buildInstallments(q);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  let cobrado = 0, porCobrar = 0, perdido = 0, nPagadas = 0, nVencidas = 0;
  let cobradoConAtraso = 0; // pagos que entraron DESPUÉS de su fecha (cartera vencida recuperada)
  let proximoVencimiento = null;
  const schedule = insts.map((it, i) => {
    // Días de atraso reales: solo medibles cuando registramos la fecha en que se marcó pagado
    let diasAtraso = null;
    if (it.status === 'paid') {
      cobrado += it.amount; nPagadas++;
      if (it.paidAt && it.fecha) {
        diasAtraso = Math.max(0, Math.round((new Date(it.paidAt) - new Date(it.fecha)) / DAY));
        if (diasAtraso > 0) cobradoConAtraso += it.amount;
      }
    } else if (it.status === 'lost') { perdido += it.amount; }
    else {
      porCobrar += it.amount;
      if (it.fecha) {
        const d = new Date(it.fecha); d.setHours(0, 0, 0, 0);
        if (d < hoy) nVencidas++;
        if (!proximoVencimiento || d < proximoVencimiento) proximoVencimiento = d;
      }
    }
    return {
      number: i + 1, label: `Pago ${i + 1}`, amount: it.amount,
      dueDate: it.fecha || null, status: it.status,
      paidAt: it.paidAt || null, diasAtraso,
    };
  });

  return {
    montoTotal: total,
    pagado: cobrado,
    // "Por cobrar" al estilo Pagos = todo lo no cobrado (incluye cartera perdida).
    pendiente: porCobrar + perdido,
    porCobrarActivo: porCobrar,
    perdido,
    cobradoConAtraso,
    nParcialidades: schedule.length,
    nPagadas,
    nVencidas,
    proximoVencimiento,
    liquidado: porCobrar < 0.5,
    schedule,
  };
}

async function resolveDoc(type, id) {
  if (!VALID_TYPES.includes(type) || !mongoose.Types.ObjectId.isValid(id)) return null;
  const query = { [type]: id };
  let doc = await Seguimiento.findOne(query);
  if (!doc) doc = await Seguimiento.create(query);
  return doc;
}

// historial_chat puede venir como array, string JSON o string con '=' inicial (bug viejo de n8n)
function parseHist(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw.replace(/^=/, '')); } catch { return []; }
  }
  return [];
}

/* ─────────────── atención WhatsApp (Supabase) ───────────────
 * Para cada teléfono devuelve el último mensaje del lead y la última respuesta
 * nuestra (rol assistant) leyendo historial_chat. Si Supabase no está disponible
 * el tablero sigue funcionando sin la capa de atención. */
async function fetchAtencionWhatsApp(phones) {
  const map = new Map();
  if (!supabaseAdmin) return map;
  const keys = [...new Set(phones.map(last10).filter((d) => d.length === 10))];
  if (!keys.length) return map;
  // wa_id llega como 52XXXXXXXXXX o 521XXXXXXXXXX según la época del lead
  const waIds = keys.flatMap((k) => [`52${k}`, `521${k}`]);
  try {
    for (let i = 0; i < waIds.length; i += 200) {
      const { data, error } = await supabaseAdmin
        .from('leads')
        .select('wa_id, historial_chat')
        .in('wa_id', waIds.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const lead of data || []) {
        const hist = parseHist(lead.historial_chat);
        let lastUser = null, lastAssistant = null;
        for (let j = hist.length - 1; j >= 0 && (!lastUser || !lastAssistant); j--) {
          const m = hist[j];
          const ts = m?.timestamp ? new Date(m.timestamp) : null;
          if (!ts || Number.isNaN(ts.getTime())) continue;
          if (!lastUser && m.role === 'user') lastUser = ts;
          if (!lastAssistant && m.role === 'assistant') lastAssistant = ts;
        }
        const key = last10(lead.wa_id);
        const prev = map.get(key);
        // dos wa_id para el mismo número → quedarse con el de actividad más reciente
        if (!prev || (lastUser?.getTime() || 0) > (prev.lastLeadMsgAt?.getTime() || 0)) {
          map.set(key, { lastLeadMsgAt: lastUser, lastReplyAt: lastAssistant });
        }
      }
    }
  } catch (err) {
    console.warn('[Seguimiento] Atención WhatsApp no disponible:', err.message);
  }
  return map;
}

/* ─────────────── índice de cotizaciones por contacto ───────────────
 * TODAS las cotizaciones (cualquier status) agrupadas por teléfono y email,
 * para mostrar en el tablero las cotizaciones disponibles de cada lead y
 * verificar que ninguna se quede fuera. */
async function fetchCotizacionesIndex() {
  const all = await GeneratedQuote.find({})
    .select('clientName clientPhone clientEmail tituloTrabajo tipoTrabajo precioConDescuento precioConRecargo precioBase status createdAt esquemaTipo esquemaPago')
    .sort({ createdAt: -1 })
    .lean();
  const byPhone = new Map();
  const byEmail = new Map();
  for (const q of all) {
    const item = {
      id: String(q._id),
      titulo: q.tituloTrabajo || q.tipoTrabajo || 'Cotización',
      precio: q.precioConDescuento || q.precioConRecargo || q.precioBase || 0,
      status: q.status,
      fecha: q.createdAt,
      esquema: q.esquemaTipo ? normalizeEsquema(q.esquemaTipo) : normalizeEsquema(q.esquemaPago),
    };
    const p = last10(q.clientPhone);
    if (p.length === 10) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(item); }
    const e = String(q.clientEmail || '').trim().toLowerCase();
    if (e) { if (!byEmail.has(e)) byEmail.set(e, []); byEmail.get(e).push(item); }
  }
  return { byPhone, byEmail };
}

/* ─────────────── núcleo del tablero ───────────────
 * Compartido entre GET /seguimientos, el sync de Fireflies y las alertas. */
export async function buildSeguimientoRows() {
  const [quotes, seguimientos] = await Promise.all([
    GeneratedQuote.find({ status: 'paid' })
      .select('clientName clientEmail clientPhone tituloTrabajo tipoTrabajo vendedor precioConDescuento precioConRecargo precioBase descuentoEfectivo esquemaPago esquemaTipo pagosCustom installmentStatuses installmentPaidAt paidAt updatedAt createdAt')
      .lean(),
    Seguimiento.find({}).lean(),
  ]);

  const quoteIds = quotes.map((q) => q._id);
  const projects = quoteIds.length
    ? await Project.find({ generatedQuote: { $in: quoteIds } }).select('generatedQuote status progress dueDate clientPhone clientEmail').lean()
    : [];
  const projByQuote = new Map();
  for (const p of projects) if (p.generatedQuote) projByQuote.set(String(p.generatedQuote), p);
  const segByQuote = new Map();
  for (const s of seguimientos) if (s.quote) segByQuote.set(String(s.quote), s);

  const phones = quotes.map((q) => projByQuote.get(String(q._id))?.clientPhone || q.clientPhone || '');
  const [atencionMap, cotIndex] = await Promise.all([
    fetchAtencionWhatsApp(phones),
    fetchCotizacionesIndex(),
  ]);

  const rows = quotes.map((q) => {
    const proj = projByQuote.get(String(q._id));
    const seg = segByQuote.get(String(q._id));
    const rec = reconcile(q);
    const celular = proj?.clientPhone || q.clientPhone || '';
    const email = proj?.clientEmail || q.clientEmail || '';

    // Atención: último mensaje del lead vs última respuesta nuestra (WhatsApp + notas del panel)
    const wa = atencionMap.get(last10(celular)) || {};
    const lastNotaAt = (seg?.notas || []).reduce((max, n) => {
      const f = n?.fecha ? new Date(n.fecha) : null;
      return f && (!max || f > max) ? f : max;
    }, null);
    const lastSeguimientoAt = [wa.lastReplyAt, lastNotaAt].filter(Boolean).sort((a, b) => b - a)[0] || null;
    const sinRespuesta = !!(wa.lastLeadMsgAt && (!lastSeguimientoAt || wa.lastLeadMsgAt > lastSeguimientoAt));

    // Cotizaciones del contacto (por teléfono y por email, sin duplicar)
    const cotSet = new Map();
    for (const c of (cotIndex.byPhone.get(last10(celular)) || [])) cotSet.set(c.id, c);
    for (const c of (cotIndex.byEmail.get(String(email).trim().toLowerCase()) || [])) cotSet.set(c.id, c);
    const cotizaciones = [...cotSet.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    // Último acuerdo con fecha de entrega pactada
    const acuerdos = seg?.acuerdos || [];
    const ultimoAcuerdo = acuerdos.length ? acuerdos[acuerdos.length - 1] : null;

    return {
      type: 'quote',
      id: String(q._id),
      cliente: seg?.nombre || q.clientName || 'Cliente',
      nombre: seg?.nombre || '',
      prioritario: !!seg?.prioritario,
      celular,
      email,
      vendedor: seg?.vendedor || q.vendedor || '',
      modalidad: q.esquemaTipo ? normalizeEsquema(q.esquemaTipo) : normalizeEsquema(q.esquemaPago),
      title: q.tituloTrabajo || q.tipoTrabajo || '',
      fechaEntrega: seg?.fechaEntrega || proj?.dueDate || null,
      metodo: '',
      paymentStatus: '',
      projectStatus: proj?.status || '',
      progress: proj?.progress ?? null,
      ...rec,
      estado: seg?.estado || (rec.liquidado ? 'liquidado' : 'sin_gestion'),
      notas: seg?.notas || [],
      archivos: seg?.archivos || [],
      comprobantes: seg?.comprobantes || [],
      acuerdos,
      ultimoAcuerdo,
      cotizaciones,
      atencion: {
        lastLeadMsgAt: wa.lastLeadMsgAt || null,
        lastSeguimientoAt,
        sinRespuesta,
        diasSinRespuesta: sinRespuesta ? diasDesde(wa.lastLeadMsgAt) : null,
        diasSinSeguimiento: lastSeguimientoAt ? diasDesde(lastSeguimientoAt) : null,
      },
    };
  });

  rows.sort((a, b) => {
    if (a.prioritario !== b.prioritario) return b.prioritario - a.prioritario;
    if ((b.nVencidas > 0) !== (a.nVencidas > 0)) return (b.nVencidas > 0) - (a.nVencidas > 0);
    if ((b.pendiente > 0) !== (a.pendiente > 0)) return (b.pendiente > 0) - (a.pendiente > 0);
    return (a.cliente || '').localeCompare(b.cliente || '');
  });

  const totales = rows.reduce((t, r) => {
    t.clientes++;
    t.montoTotal += r.montoTotal || 0;
    t.pagado += r.pagado || 0;
    t.pendiente += r.pendiente || 0;
    t.perdido += r.perdido || 0;
    t.cobradoConAtraso += r.cobradoConAtraso || 0;
    if (r.nVencidas > 0) t.conVencidas++;
    if (r.atencion?.sinRespuesta) t.sinRespuesta++;
    return t;
  }, { clientes: 0, montoTotal: 0, pagado: 0, pendiente: 0, perdido: 0, cobradoConAtraso: 0, conVencidas: 0, sinRespuesta: 0 });

  return { rows, totales };
}

/* ─────────────── GET /seguimientos ─────────────── */
export const getSeguimientos = asyncHandler(async (req, res) => {
  res.json(await buildSeguimientoRows());
});

/* ─────────────── POST /:type/:id/nota ─────────────── */
export const addNota = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { texto } = req.body;
  if (!VALID_TYPES.includes(type)) { res.status(400); throw new Error('type inválido'); }
  if (!texto || !texto.trim()) { res.status(400); throw new Error('La nota no puede estar vacía'); }
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(400); throw new Error('id inválido'); }
  const autor = req.user?.name || req.user?.nombre || 'admin';
  doc.notas.push({ texto: texto.trim(), autor, fecha: new Date() });
  await doc.save();
  res.status(201).json({ notas: doc.notas });
});

/* ─────────────── DELETE /:type/:id/nota/:notaId ─────────────── */
export const deleteNota = asyncHandler(async (req, res) => {
  const { type, id, notaId } = req.params;
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(404); throw new Error('Seguimiento no encontrado'); }
  doc.notas = doc.notas.filter((n) => String(n._id) !== String(notaId));
  await doc.save();
  res.json({ notas: doc.notas });
});

/* ─────────────── PATCH /:type/:id (overrides manuales) ─────────────── */
export const updateSeguimiento = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { vendedor, fechaEntrega, estado, nombre, prioritario } = req.body;
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(400); throw new Error('id inválido'); }
  if (vendedor !== undefined) doc.vendedor = vendedor;
  if (fechaEntrega !== undefined) doc.fechaEntrega = fechaEntrega || null;
  if (estado !== undefined) doc.estado = estado;
  if (nombre !== undefined) doc.nombre = nombre;
  if (prioritario !== undefined) doc.prioritario = !!prioritario;
  await doc.save();
  res.json({ vendedor: doc.vendedor, fechaEntrega: doc.fechaEntrega, estado: doc.estado, nombre: doc.nombre, prioritario: doc.prioritario });
});

/* ─────────────── POST /:type/:id/archivo (upload Cloudinary) ─────────────── */
export const uploadArchivo = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  if (!req.file) { res.status(400); throw new Error('No se envió ningún archivo'); }
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(400); throw new Error('id inválido'); }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'tesipedia/seguimientos', resource_type: 'auto', public_id: `seg_${id}_${Date.now()}` },
      (error, uploaded) => (error ? reject(error) : resolve(uploaded)),
    );
    stream.end(req.file.buffer);
  });

  doc.archivos.push({
    url: result.secure_url,
    publicId: result.public_id,
    nombre: req.file.originalname,
    size: req.file.size,
    tipo: req.file.mimetype,
    subidoPor: req.user?.name || req.user?.nombre || 'admin',
    subidoEn: new Date(),
  });
  await doc.save();
  res.status(201).json({ archivos: doc.archivos });
});

/* ─────────────── DELETE /:type/:id/archivo/:archivoId ─────────────── */
export const deleteArchivo = asyncHandler(async (req, res) => {
  const { type, id, archivoId } = req.params;
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(404); throw new Error('Seguimiento no encontrado'); }
  const archivo = doc.archivos.find((a) => String(a._id) === String(archivoId));
  if (archivo?.publicId) {
    try { await cloudinary.uploader.destroy(archivo.publicId, { resource_type: 'raw' }); }
    catch { try { await cloudinary.uploader.destroy(archivo.publicId); } catch { /* noop */ } }
  }
  doc.archivos = doc.archivos.filter((a) => String(a._id) !== String(archivoId));
  await doc.save();
  res.json({ archivos: doc.archivos });
});

/* ─────────────── POST /:type/:id/comprobante ───────────────
 * Comprobante de pago ligado a una parcialidad. Las imágenes se comprimen
 * en el servidor (sharp → JPEG 72%, máx 1600px) antes de subir a Cloudinary. */
export const uploadComprobante = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const installmentIdx = Number(req.body?.installmentIdx);
  if (!req.file) { res.status(400); throw new Error('No se envió ningún archivo'); }
  if (!Number.isInteger(installmentIdx) || installmentIdx < 0) { res.status(400); throw new Error('installmentIdx inválido'); }
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(400); throw new Error('id inválido'); }

  let buffer = req.file.buffer;
  const sizeOriginal = req.file.size;
  let tipo = req.file.mimetype;
  let nombre = req.file.originalname;
  if (/^image\/(jpe?g|png|webp|tiff?|bmp)$/i.test(tipo)) {
    try {
      // Import dinámico: si sharp no está disponible en el servidor, se sube el
      // original sin comprimir en lugar de tirar el proceso al arrancar.
      const sharp = (await import('sharp')).default;
      const comprimido = await sharp(buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer();
      if (comprimido.length < buffer.length) {
        buffer = comprimido;
        tipo = 'image/jpeg';
        nombre = nombre.replace(/\.(png|jpe?g|webp|bmp|tiff?)$/i, '') + '.jpg';
      }
    } catch { /* si sharp falla se sube el original */ }
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'tesipedia/comprobantes', resource_type: 'auto', public_id: `comp_${id}_${installmentIdx}_${Date.now()}` },
      (error, uploaded) => (error ? reject(error) : resolve(uploaded)),
    );
    stream.end(buffer);
  });

  doc.comprobantes.push({
    installmentIdx,
    url: result.secure_url,
    publicId: result.public_id,
    nombre,
    size: buffer.length,
    sizeOriginal,
    tipo,
    subidoPor: req.user?.name || req.user?.nombre || 'admin',
    subidoEn: new Date(),
  });
  await doc.save();
  res.status(201).json({ comprobantes: doc.comprobantes });
});

/* ─────────────── DELETE /:type/:id/comprobante/:comprobanteId ─────────────── */
export const deleteComprobante = asyncHandler(async (req, res) => {
  const { type, id, comprobanteId } = req.params;
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(404); throw new Error('Seguimiento no encontrado'); }
  const comp = doc.comprobantes.find((c) => String(c._id) === String(comprobanteId));
  if (comp?.publicId) {
    try { await cloudinary.uploader.destroy(comp.publicId); }
    catch { try { await cloudinary.uploader.destroy(comp.publicId, { resource_type: 'raw' }); } catch { /* noop */ } }
  }
  doc.comprobantes = doc.comprobantes.filter((c) => String(c._id) !== String(comprobanteId));
  await doc.save();
  res.json({ comprobantes: doc.comprobantes });
});

/* ─────────────── POST /:type/:id/acuerdo ───────────────
 * Acuerdo manual con el lead: correcciones pactadas y/o nueva fecha de entrega.
 * Si trae fecha, esa pasa a ser la fecha de entrega visible del tablero. */
export const addAcuerdo = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { texto, fechaEntrega } = req.body;
  if ((!texto || !texto.trim()) && !fechaEntrega) {
    res.status(400); throw new Error('El acuerdo necesita correcciones o una fecha de entrega');
  }
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(400); throw new Error('id inválido'); }
  doc.acuerdos.push({
    texto: (texto || '').trim(),
    fechaEntrega: fechaEntrega ? new Date(fechaEntrega) : null,
    fuente: 'manual',
    autor: req.user?.name || req.user?.nombre || 'admin',
    creadoEn: new Date(),
  });
  if (fechaEntrega) doc.fechaEntrega = new Date(fechaEntrega);
  await doc.save();
  res.status(201).json({ acuerdos: doc.acuerdos, fechaEntrega: doc.fechaEntrega });
});

/* ─────────────── DELETE /:type/:id/acuerdo/:acuerdoId ─────────────── */
export const deleteAcuerdo = asyncHandler(async (req, res) => {
  const { type, id, acuerdoId } = req.params;
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(404); throw new Error('Seguimiento no encontrado'); }
  doc.acuerdos = doc.acuerdos.filter((a) => String(a._id) !== String(acuerdoId));
  await doc.save();
  res.json({ acuerdos: doc.acuerdos });
});

/* ─────────────── POST /seguimientos/fireflies/sync ───────────────
 * Lee las sesiones recientes de Fireflies y con Haiku extrae, por sesión,
 * a qué cliente del tablero corresponde y qué se acordó (correcciones y/o
 * fecha de entrega). Los acuerdos se guardan con fuente 'fireflies' y se
 * deduplican por meetingId, así el botón se puede presionar sin miedo. */
export const syncFireflies = asyncHandler(async (req, res) => {
  const ffKey = process.env.FIREFLIES_API_KEY;
  const antKey = process.env.ANTHROPIC_API_KEY;
  if (!ffKey) { res.status(400); throw new Error('Falta FIREFLIES_API_KEY en el servidor (Railway)'); }
  if (!antKey) { res.status(400); throw new Error('Falta ANTHROPIC_API_KEY en el servidor'); }
  const dias = Math.min(Number(req.body?.dias) || 14, 60);

  // 1) Sesiones recientes (GraphQL de Fireflies)
  const gql = {
    query: `query Recientes($fromDate: DateTime) {
      transcripts(fromDate: $fromDate, limit: 25) {
        id title date participants
        summary { overview action_items }
      }
    }`,
    variables: { fromDate: new Date(Date.now() - dias * DAY).toISOString() },
  };
  const ffRes = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ffKey}` },
    body: JSON.stringify(gql),
  });
  const ffJson = await ffRes.json().catch(() => ({}));
  if (!ffRes.ok || ffJson.errors?.length) {
    res.status(502);
    throw new Error(`Fireflies: ${ffJson.errors?.[0]?.message || `HTTP ${ffRes.status}`}`);
  }
  const meetings = ffJson.data?.transcripts || [];
  if (!meetings.length) return res.json({ meetings: 0, nuevos: 0, detalle: [] });

  // 2) No re-importar sesiones ya procesadas
  const meetingIds = meetings.map((m) => String(m.id));
  const yaImportados = await Seguimiento.find({ 'acuerdos.meetingId': { $in: meetingIds } })
    .select('acuerdos.meetingId').lean();
  const importedSet = new Set(yaImportados.flatMap((s) => (s.acuerdos || []).map((a) => a.meetingId)).filter(Boolean));
  const pendientes = meetings.filter((m) => !importedSet.has(String(m.id)));
  if (!pendientes.length) return res.json({ meetings: meetings.length, nuevos: 0, detalle: [], nota: 'Todas las sesiones ya estaban importadas' });

  // 3) Candidatos del tablero para que Haiku haga el match
  const { rows } = await buildSeguimientoRows();
  const candidatos = rows.map((r) => ({ id: r.id, cliente: r.cliente, proyecto: r.title }));

  const anthropic = new Anthropic({ apiKey: antKey });
  const detalle = [];
  let nuevos = 0;

  for (const m of pendientes) {
    const meetingDate = m.date ? new Date(Number(m.date) || m.date) : null;
    const resumen = [
      `Título: ${m.title || '(sin título)'}`,
      `Fecha: ${meetingDate ? meetingDate.toISOString().slice(0, 10) : 'desconocida'}`,
      `Participantes: ${(m.participants || []).join(', ') || 'desconocidos'}`,
      `Resumen: ${m.summary?.overview || '(sin resumen)'}`,
      `Acuerdos/acciones: ${m.summary?.action_items || '(sin action items)'}`,
    ].join('\n');

    let matches = [];
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: 'Extraes acuerdos de sesiones con clientes de Tesipedia (proyectos de tesis). Respondes SOLO con JSON válido, sin markdown.',
        messages: [{
          role: 'user',
          content: `SESIÓN:\n${resumen}\n\nCLIENTES DEL TABLERO (JSON):\n${JSON.stringify(candidatos)}\n\nIdentifica a qué cliente(s) del tablero corresponde esta sesión y qué se acordó. Devuelve SOLO este JSON:\n{"matches":[{"quoteId":"<id del tablero>","correcciones":"<correcciones o acuerdos pactados, en español>","fechaEntrega":"YYYY-MM-DD o null si no se mencionó fecha"}]}\nReglas: si la sesión no es con ninguno de esos clientes devuelve {"matches":[]}. NO inventes fechas: solo pon fechaEntrega si en la sesión se mencionó una fecha de entrega o de correcciones explícita.`,
        }],
      });
      const raw = msg.content?.[0]?.text || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      matches = jsonMatch ? (JSON.parse(jsonMatch[0]).matches || []) : [];
    } catch (err) {
      detalle.push({ meeting: m.title, error: err.message });
      continue;
    }

    const validIds = new Set(candidatos.map((c) => c.id));
    for (const match of matches) {
      if (!match?.quoteId || !validIds.has(String(match.quoteId))) continue;
      const doc = await resolveDoc('quote', String(match.quoteId));
      if (!doc) continue;
      const fecha = match.fechaEntrega && /^\d{4}-\d{2}-\d{2}$/.test(match.fechaEntrega)
        ? new Date(`${match.fechaEntrega}T12:00:00`) : null;
      doc.acuerdos.push({
        texto: (match.correcciones || '').trim(),
        fechaEntrega: fecha,
        fuente: 'fireflies',
        meetingId: String(m.id),
        meetingTitle: m.title || '',
        meetingDate,
        autor: 'Fireflies + Haiku',
        creadoEn: new Date(),
      });
      if (fecha) doc.fechaEntrega = fecha;
      await doc.save();
      nuevos++;
      detalle.push({ meeting: m.title, cliente: candidatos.find((c) => c.id === String(match.quoteId))?.cliente, correcciones: match.correcciones, fechaEntrega: match.fechaEntrega || null });
    }
  }

  res.json({ meetings: meetings.length, procesadas: pendientes.length, nuevos, detalle });
});

/* ─────────────── alertas → sistema de notificaciones ───────────────
 * Corre desde server.js (arranque + cada 6h). Crea notificaciones type
 * 'seguimiento' para el badge del sidebar: pagos vencidos, leads sin
 * respuesta y clientes con saldo sin seguimiento. Dedupe: no repite la
 * misma alerta (quote+motivo) si ya se creó en los últimos 3 días. */
export async function runSeguimientoAlerts(app) {
  try {
    const superAdmin = process.env.SUPER_ADMIN_ID;
    if (!superAdmin) return;
    const { rows } = await buildSeguimientoRows();
    const since = new Date(Date.now() - 3 * DAY);
    const recientes = await Notification.find({ type: 'seguimiento', createdAt: { $gte: since } }).select('data').lean();
    const yaAvisadas = new Set(recientes.map((n) => `${n.data?.quoteId}:${n.data?.kind}`));
    const mxn = (n) => `$${Math.round(n || 0).toLocaleString('es-MX')}`;

    let creadas = 0;
    for (const r of rows) {
      if (r.estado === 'incobrable' || r.liquidado) continue;
      const alertas = [];
      if (r.nVencidas > 0 && r.porCobrarActivo > 0.5) {
        alertas.push({ kind: 'vencido', priority: 'high', message: `💸 ${r.cliente}: ${r.nVencidas} pago(s) vencido(s) · ${mxn(r.porCobrarActivo)} por cobrar` });
      }
      if (r.atencion?.sinRespuesta && (r.atencion.diasSinRespuesta ?? 0) >= 2) {
        alertas.push({ kind: 'sin_respuesta', priority: 'high', message: `📩 ${r.cliente} escribió hace ${r.atencion.diasSinRespuesta} días y no le hemos respondido` });
      } else if (r.pendiente > 0.5 && (r.atencion?.diasSinSeguimiento == null || r.atencion.diasSinSeguimiento >= 7)) {
        const cuanto = r.atencion?.diasSinSeguimiento != null ? `${r.atencion.diasSinSeguimiento} días` : 'mucho tiempo';
        alertas.push({ kind: 'sin_seguimiento', priority: 'medium', message: `👀 ${r.cliente} lleva ${cuanto} sin seguimiento y debe ${mxn(r.pendiente)}` });
      }
      for (const a of alertas) {
        const key = `${r.id}:${a.kind}`;
        if (yaAvisadas.has(key)) continue;
        await createNotification(app, {
          user: superAdmin,
          type: 'seguimiento',
          message: a.message,
          data: { quoteId: r.id, kind: a.kind },
          link: '/admin/seguimiento-mensual',
          priority: a.priority,
        });
        yaAvisadas.add(key);
        creadas++;
      }
    }
    if (creadas) console.log(`[SeguimientoAlerts] ${creadas} notificaciones nuevas`);
  } catch (err) {
    console.error('[SeguimientoAlerts] Error:', err.message);
  }
}
