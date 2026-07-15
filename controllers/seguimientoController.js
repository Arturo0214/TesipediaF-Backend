import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Project from '../models/Project.js';
import Seguimiento from '../models/Seguimiento.js';
import cloudinary from '../config/cloudinary.js';

/* ─────────────── helpers ─────────────── */

// Concilia el schedule de parcialidades contra su estado real de pago.
function reconcile(payment) {
  const schedule = Array.isArray(payment.schedule) ? payment.schedule : [];
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  if (schedule.length === 0) {
    // Pago sin parcialidades (único / online): pagado si status completed.
    const pagado = payment.status === 'completed';
    return {
      montoTotal: payment.amount || 0,
      pagado: pagado ? (payment.amount || 0) : 0,
      pendiente: pagado ? 0 : (payment.amount || 0),
      nParcialidades: 0, nPagadas: 0, nVencidas: pagado ? 0 : (payment.amount ? 1 : 0),
      proximoVencimiento: null,
      liquidado: pagado,
    };
  }

  let pagado = 0, pendiente = 0, nPagadas = 0, nVencidas = 0;
  let proximoVencimiento = null;
  for (const inst of schedule) {
    const monto = Number(inst.amount) || 0;
    if (inst.status === 'paid') { pagado += monto; nPagadas++; continue; }
    pendiente += monto;
    if (inst.dueDate) {
      const d = new Date(inst.dueDate); d.setHours(0, 0, 0, 0);
      if (d < hoy) nVencidas++;
      if (!proximoVencimiento || d < proximoVencimiento) proximoVencimiento = d;
    }
  }
  const montoTotal = pagado + pendiente;
  return {
    montoTotal,
    pagado,
    pendiente,
    nParcialidades: schedule.length,
    nPagadas,
    nVencidas,
    proximoVencimiento,
    liquidado: pendiente === 0,
  };
}

function scheduleView(payment) {
  return (payment.schedule || []).map((s) => ({
    number: s.number,
    label: s.label || (s.number ? `Pago ${s.number}` : ''),
    amount: Number(s.amount) || 0,
    dueDate: s.dueDate || null,
    status: s.status || 'pending',
  }));
}

// Busca (o crea) el doc de seguimiento manual para una fila.
async function resolveDoc(type, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const query = type === 'project' ? { project: id } : { payment: id };
  let doc = await Seguimiento.findOne(query);
  if (!doc) doc = await Seguimiento.create(query);
  return doc;
}

/* ─────────────── GET /api/seguimientos ─────────────── */
// Devuelve una fila por CADA cliente (todos los pagos + proyectos sin pago),
// con los datos financieros en vivo (conciliados) y la capa manual (notas/archivos).
export const getSeguimientos = asyncHandler(async (req, res) => {
  const [payments, projects, seguimientos] = await Promise.all([
    Payment.find({}).lean(),
    Project.find({}).select('clientName clientEmail clientPhone payment status taskTitle dueDate vendedor').lean(),
    Seguimiento.find({}).lean(),
  ]);

  const projByPayment = new Map();      // paymentId -> project
  const projectsWithPayment = new Set(); // projectIds vinculados a un pago
  for (const p of projects) {
    if (p.payment) { projByPayment.set(String(p.payment), p); projectsWithPayment.add(String(p._id)); }
  }
  const segByPayment = new Map();
  const segByProject = new Map();
  for (const s of seguimientos) {
    if (s.payment) segByPayment.set(String(s.payment), s);
    if (s.project) segByProject.set(String(s.project), s);
  }

  const rows = [];

  // 1) Una fila por pago (universo financiero: incluye pagados, únicos y pendientes)
  for (const pay of payments) {
    const proj = projByPayment.get(String(pay._id));
    // Omitir pagos anónimos de pasarela (PayPal/Stripe sin nombre ni proyecto): no son cobranza.
    const clienteNombre = pay.clientName || proj?.clientName;
    if (!clienteNombre || !String(clienteNombre).trim()) continue;
    const seg = segByPayment.get(String(pay._id));
    const rec = reconcile(pay);
    rows.push({
      type: 'payment',
      id: String(pay._id),
      cliente: clienteNombre,
      celular: pay.clientPhone || proj?.clientPhone || '',
      email: pay.clientEmail || proj?.clientEmail || '',
      vendedor: seg?.vendedor || pay.vendedor || proj?.vendedor || '',
      modalidad: pay.esquemaPago || '',
      title: pay.title || proj?.taskTitle || '',
      fechaEntrega: seg?.fechaEntrega || proj?.dueDate || null,
      metodo: pay.method || '',
      paymentStatus: pay.status || '',
      projectStatus: proj?.status || '',
      schedule: scheduleView(pay),
      ...rec,
      estado: seg?.estado || (rec.liquidado ? 'liquidado' : 'sin_gestion'),
      notas: seg?.notas || [],
      archivos: seg?.archivos || [],
    });
  }

  // 2) Proyectos SIN pago vinculado → también se listan (cliente sin registro financiero)
  for (const proj of projects) {
    if (proj.payment) continue; // ya cubierto arriba
    const seg = segByProject.get(String(proj._id));
    rows.push({
      type: 'project',
      id: String(proj._id),
      cliente: proj.clientName || '(sin nombre)',
      celular: proj.clientPhone || '',
      email: proj.clientEmail || '',
      vendedor: seg?.vendedor || proj.vendedor || '',
      modalidad: '',
      title: proj.taskTitle || '',
      fechaEntrega: seg?.fechaEntrega || proj.dueDate || null,
      metodo: '',
      paymentStatus: '',
      projectStatus: proj.status || '',
      schedule: [],
      montoTotal: 0, pagado: 0, pendiente: 0, nParcialidades: 0, nPagadas: 0, nVencidas: 0,
      proximoVencimiento: null, liquidado: false,
      estado: seg?.estado || 'sin_gestion',
      notas: seg?.notas || [],
      archivos: seg?.archivos || [],
    });
  }

  // Orden: primero con saldo pendiente/vencidas, luego por nombre
  rows.sort((a, b) => {
    if ((b.nVencidas > 0) !== (a.nVencidas > 0)) return (b.nVencidas > 0) - (a.nVencidas > 0);
    if ((b.pendiente > 0) !== (a.pendiente > 0)) return (b.pendiente > 0) - (a.pendiente > 0);
    return (a.cliente || '').localeCompare(b.cliente || '');
  });

  // Totales de conciliación
  const totales = rows.reduce((t, r) => {
    t.clientes++;
    t.montoTotal += r.montoTotal || 0;
    t.pagado += r.pagado || 0;
    t.pendiente += r.pendiente || 0;
    if (r.nVencidas > 0) t.conVencidas++;
    return t;
  }, { clientes: 0, montoTotal: 0, pagado: 0, pendiente: 0, conVencidas: 0 });

  res.json({ rows, totales });
});

/* ─────────────── POST /:type/:id/nota ─────────────── */
export const addNota = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { texto } = req.body;
  if (!['payment', 'project'].includes(type)) { res.status(400); throw new Error('type inválido'); }
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

  const archivo = {
    url: result.secure_url,
    publicId: result.public_id,
    nombre: req.file.originalname,
    size: req.file.size,
    tipo: req.file.mimetype,
    subidoPor: req.user?.name || req.user?.nombre || 'admin',
    subidoEn: new Date(),
  };
  doc.archivos.push(archivo);
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
