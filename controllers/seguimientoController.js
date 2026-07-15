import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import GeneratedQuote from '../models/GeneratedQuote.js';
import Project from '../models/Project.js';
import Seguimiento from '../models/Seguimiento.js';
import cloudinary from '../config/cloudinary.js';
import { buildInstallments, normalizeEsquema } from '../utils/quoteSchedule.js';

/* ─────────────── helpers ─────────────── */
const VALID_TYPES = ['quote', 'payment', 'project'];

// Concilia las parcialidades de una cotización pagada — MISMA lógica que Revenue/Pagos.
function reconcile(q) {
  const total = q.precioConDescuento || q.precioConRecargo || q.precioBase || 0;
  const insts = buildInstallments(q);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  let cobrado = 0, porCobrar = 0, perdido = 0, nPagadas = 0, nVencidas = 0;
  let proximoVencimiento = null;
  const schedule = insts.map((it, i) => {
    if (it.status === 'paid') { cobrado += it.amount; nPagadas++; }
    else if (it.status === 'lost') { perdido += it.amount; }
    else {
      porCobrar += it.amount;
      if (it.fecha) {
        const d = new Date(it.fecha); d.setHours(0, 0, 0, 0);
        if (d < hoy) nVencidas++;
        if (!proximoVencimiento || d < proximoVencimiento) proximoVencimiento = d;
      }
    }
    return { number: i + 1, label: `Pago ${i + 1}`, amount: it.amount, dueDate: it.fecha || null, status: it.status };
  });

  return {
    montoTotal: total,
    pagado: cobrado,
    // "Por cobrar" al estilo Pagos = todo lo no cobrado (incluye cartera perdida).
    pendiente: porCobrar + perdido,
    porCobrarActivo: porCobrar,
    perdido,
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

/* ─────────────── GET /seguimientos ─────────────── */
// Fila por cada cotización pagada (mismos clientes/números que Pagos y Revenue),
// conciliada en vivo, + capa manual (notas/archivos/estado).
export const getSeguimientos = asyncHandler(async (req, res) => {
  const [quotes, seguimientos] = await Promise.all([
    GeneratedQuote.find({ status: 'paid' })
      .select('clientName clientEmail clientPhone tituloTrabajo tipoTrabajo vendedor precioConDescuento precioConRecargo precioBase descuentoEfectivo esquemaPago esquemaTipo pagosCustom installmentStatuses paidAt updatedAt createdAt')
      .lean(),
    Seguimiento.find({}).lean(),
  ]);

  const quoteIds = quotes.map((q) => q._id);
  const projects = quoteIds.length
    ? await Project.find({ generatedQuote: { $in: quoteIds } }).select('generatedQuote status dueDate clientPhone clientEmail').lean()
    : [];
  const projByQuote = new Map();
  for (const p of projects) if (p.generatedQuote) projByQuote.set(String(p.generatedQuote), p);
  const segByQuote = new Map();
  for (const s of seguimientos) if (s.quote) segByQuote.set(String(s.quote), s);

  const rows = quotes.map((q) => {
    const proj = projByQuote.get(String(q._id));
    const seg = segByQuote.get(String(q._id));
    const rec = reconcile(q);
    return {
      type: 'quote',
      id: String(q._id),
      cliente: q.clientName || 'Cliente',
      celular: proj?.clientPhone || q.clientPhone || '',
      email: proj?.clientEmail || q.clientEmail || '',
      vendedor: seg?.vendedor || q.vendedor || '',
      modalidad: q.esquemaTipo ? normalizeEsquema(q.esquemaTipo) : normalizeEsquema(q.esquemaPago),
      title: q.tituloTrabajo || q.tipoTrabajo || '',
      fechaEntrega: seg?.fechaEntrega || proj?.dueDate || null,
      metodo: '',
      paymentStatus: '',
      projectStatus: proj?.status || '',
      ...rec,
      estado: seg?.estado || (rec.liquidado ? 'liquidado' : 'sin_gestion'),
      notas: seg?.notas || [],
      archivos: seg?.archivos || [],
    };
  });

  rows.sort((a, b) => {
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
    if (r.nVencidas > 0) t.conVencidas++;
    return t;
  }, { clientes: 0, montoTotal: 0, pagado: 0, pendiente: 0, perdido: 0, conVencidas: 0 });

  res.json({ rows, totales });
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
  const { vendedor, fechaEntrega, estado } = req.body;
  const doc = await resolveDoc(type, id);
  if (!doc) { res.status(400); throw new Error('id inválido'); }
  if (vendedor !== undefined) doc.vendedor = vendedor;
  if (fechaEntrega !== undefined) doc.fechaEntrega = fechaEntrega || null;
  if (estado !== undefined) doc.estado = estado;
  await doc.save();
  res.json({ vendedor: doc.vendedor, fechaEntrega: doc.fechaEntrega, estado: doc.estado });
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
