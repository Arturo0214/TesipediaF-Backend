import express from 'express';
import asyncHandler from 'express-async-handler';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import GeneratedQuote from '../models/GeneratedQuote.js';
import Payment from '../models/Payment.js';
import Project from '../models/Project.js';
import Seguimiento from '../models/Seguimiento.js';
import Resena from '../models/Resena.js';
import { filtroPrivado, puedeVerVentasPrivadas } from '../utils/ventasPrivadas.js';
import { buildSeguimientoRows } from '../controllers/seguimientoController.js';

const router = express.Router();

// ═══════════════════════════════════════════════════
// Biblioteca — concentra cotizaciones, métricas, reseñas,
// proyectos y archivos, y genera el paquete de contexto
// que alimenta a la IA (Sofia).
// ═══════════════════════════════════════════════════

// Acceso al contexto IA: admin logueado O token de servicio (n8n)
const iaAuth = (req, res, next) => {
  const tok = req.get('x-biblioteca-token');
  if (process.env.BIBLIOTECA_IA_TOKEN && tok && tok === process.env.BIBLIOTECA_IA_TOKEN) {
    req.iaAccess = true;
    return next();
  }
  return protect(req, res, (err) => {
    if (err) return next(err);
    return adminOnly(req, res, next);
  });
};

const mediana = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const topN = (map, n = 8) =>
  Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ nombre: k, veces: v }));

// Ids de cotizaciones privadas (para filtrar proyectos/archivos ligados)
async function privateQuoteIds(user) {
  if (puedeVerVentasPrivadas(user)) return null;
  const privadas = await GeneratedQuote.find({ privado: true }).select('_id').lean();
  return new Set(privadas.map((q) => String(q._id)));
}

// ───────────────────────────────────────────────────
// GET /biblioteca/resumen — tarjetas del tab Métricas
// ───────────────────────────────────────────────────
router.get('/resumen', protect, adminOnly, asyncHandler(async (req, res) => {
  const noPriv = filtroPrivado(req.user);
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const [quotes, resenasCount, proyectosActivos, seguimientos] = await Promise.all([
    GeneratedQuote.find(noPriv)
      .select('status paidAt precioConDescuento extensionEstimada tipoTrabajo tipoServicio area carrera vendedor createdAt pdfUrl')
      .lean(),
    Resena.countDocuments({}),
    Project.countDocuments({ status: { $in: ['pending', 'in_progress', 'review'] } }),
    Seguimiento.find({}).select('archivos comprobantes').lean(),
  ]);

  const pagadas = quotes.filter((q) => q.status === 'paid' || q.paidAt);
  const pagadasMes = pagadas.filter((q) => q.paidAt && new Date(q.paidAt) >= inicioMes);
  const tickets = pagadas.map((q) => q.precioConDescuento || 0).filter(Boolean);
  const porPagina = pagadas
    .filter((q) => (q.extensionEstimada || 0) > 0 && (q.precioConDescuento || 0) > 0)
    .map((q) => q.precioConDescuento / q.extensionEstimada);

  let archivosSeguimiento = 0;
  seguimientos.forEach((s) => {
    archivosSeguimiento += (s.archivos || []).length + (s.comprobantes || []).length;
  });
  const pdfs = quotes.filter((q) => q.pdfUrl).length;

  const porTipo = {};
  const porArea = {};
  pagadas.forEach((q) => {
    if (q.tipoTrabajo) porTipo[q.tipoTrabajo] = (porTipo[q.tipoTrabajo] || 0) + 1;
    if (q.area) porArea[q.area] = (porArea[q.area] || 0) + 1;
  });

  res.json({
    cotizaciones: {
      total: quotes.length,
      pagadas: pagadas.length,
      pagadasEsteMes: pagadasMes.length,
      ventasHistoricas: Math.round(tickets.reduce((a, b) => a + b, 0)),
      ventasEsteMes: Math.round(pagadasMes.reduce((a, b) => a + (b.precioConDescuento || 0), 0)),
      ticketMediano: Math.round(mediana(tickets)),
      precioPorPaginaMediano: Math.round(mediana(porPagina)),
    },
    proyectos: { activos: proyectosActivos },
    resenas: { total: resenasCount },
    archivos: { seguimiento: archivosSeguimiento, pdfsCotizacion: pdfs, total: archivosSeguimiento + pdfs },
    topTipos: topN(porTipo, 6),
    topAreas: topN(porArea, 6),
  });
}));

// ───────────────────────────────────────────────────
// GET /biblioteca/cotizaciones?q=&estado=&limit=
// ───────────────────────────────────────────────────
router.get('/cotizaciones', protect, adminOnly, asyncHandler(async (req, res) => {
  const { q = '', estado = '', limit = 300 } = req.query;
  const filtro = { ...filtroPrivado(req.user) };
  if (estado) filtro.status = estado;
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filtro.$or = [
      { clientName: rx }, { folio: rx }, { tituloTrabajo: rx },
      { carrera: rx }, { area: rx }, { vendedor: rx },
    ];
  }
  const docs = await GeneratedQuote.find(filtro)
    .select('folio clientName clientPhone tituloTrabajo tipoTrabajo tipoServicio area carrera extensionEstimada precioConDescuento esquemaTipo status paidAt vendedor pdfUrl privado createdAt')
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 300, 1000))
    .lean();
  res.json({ total: docs.length, cotizaciones: docs });
}));

// ───────────────────────────────────────────────────
// GET /biblioteca/proyectos — condensado de seguimiento
// ───────────────────────────────────────────────────
router.get('/proyectos', protect, adminOnly, asyncHandler(async (req, res) => {
  const { rows } = await buildSeguimientoRows(req.user);
  const proyectos = rows.map((r) => ({
    id: r.id,
    type: r.type,
    cliente: r.cliente || r.nombre,
    title: r.title,
    folio: r.folio,
    vendedor: r.vendedor,
    estado: r.estado,
    projectStatus: r.projectStatus,
    progress: r.progress,
    entregado: r.entregado,
    fechaEntrega: r.fechaEntrega,
    montoTotal: r.montoTotal,
    pagado: r.pagado,
    pendiente: r.pendiente,
    nArchivos: (r.archivos || []).length,
    nComprobantes: (r.comprobantes || []).length,
    nNotas: (r.notas || []).length,
    nAcuerdos: (r.acuerdos || []).length,
    ultimoAcuerdo: r.ultimoAcuerdo || null,
    privado: !!r.privado,
    pdfUrl: r.pdfUrl || null,
  }));
  res.json({ total: proyectos.length, proyectos });
}));

// ───────────────────────────────────────────────────
// GET /biblioteca/archivos — todos los archivos concentrados
// ───────────────────────────────────────────────────
router.get('/archivos', protect, adminOnly, asyncHandler(async (req, res) => {
  const privados = await privateQuoteIds(req.user);
  const noPriv = filtroPrivado(req.user);
  const archivos = [];

  // 1) PDFs de cotización
  const quotes = await GeneratedQuote.find({ ...noPriv, pdfUrl: { $ne: null } })
    .select('folio clientName pdfUrl createdAt tituloTrabajo')
    .sort({ createdAt: -1 })
    .lean();
  quotes.forEach((qd) => archivos.push({
    origen: 'cotizacion',
    cliente: qd.clientName,
    nombre: `Cotización ${qd.folio || ''} — ${qd.tituloTrabajo || ''}`.trim(),
    url: qd.pdfUrl,
    tipo: 'pdf',
    fecha: qd.createdAt,
  }));

  // 2) Archivos y comprobantes de Seguimiento
  const segs = await Seguimiento.find({})
    .select('nombre quote archivos comprobantes')
    .populate({ path: 'quote', select: 'clientName privado' })
    .lean();
  segs.forEach((s) => {
    if (privados && s.quote && privados.has(String(s.quote._id || s.quote))) return;
    if (!puedeVerVentasPrivadas(req.user) && s.quote?.privado) return;
    const cli = s.nombre || s.quote?.clientName || '';
    (s.archivos || []).forEach((a) => archivos.push({
      origen: a.rol === 'final' ? 'entrega' : 'soporte',
      cliente: cli, nombre: a.nombre, url: a.url, tipo: a.tipo || '', fecha: a.subidoEn, subidoPor: a.subidoPor,
    }));
    (s.comprobantes || []).forEach((c) => archivos.push({
      origen: 'comprobante',
      cliente: cli, nombre: c.nombre, url: c.url, tipo: c.tipo || '', fecha: c.subidoEn, subidoPor: c.subidoPor,
    }));
  });

  // 3) Entregables y revisiones de Project
  const projects = await Project.find({})
    .select('clientName taskTitle deliverables revisions generatedQuote')
    .lean();
  projects.forEach((p) => {
    if (privados && p.generatedQuote && privados.has(String(p.generatedQuote))) return;
    (p.deliverables || []).forEach((d) => archivos.push({
      origen: 'entrega',
      cliente: p.clientName, nombre: d.originalname || d.filename, url: d.path, tipo: d.mimetype || '', fecha: d.uploadedAt,
    }));
    (p.revisions || []).forEach((rv) => {
      if (rv.file?.path) archivos.push({
        origen: 'revision',
        cliente: p.clientName,
        nombre: rv.label || rv.file.originalname || `v${rv.version}`,
        url: rv.file.path, tipo: rv.file.mimetype || '', fecha: rv.createdAt,
      });
    });
  });

  archivos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  res.json({ total: archivos.length, archivos });
}));

// ───────────────────────────────────────────────────
// Reseñas — CRUD
// ───────────────────────────────────────────────────
router.get('/resenas', protect, adminOnly, asyncHandler(async (req, res) => {
  const resenas = await Resena.find({}).sort({ destacada: -1, fecha: -1 }).lean();
  res.json({ total: resenas.length, resenas });
}));

router.post('/resenas', protect, adminOnly, asyncHandler(async (req, res) => {
  const { cliente, texto, calificacion, fuente, servicio, destacada, fecha } = req.body;
  if (!cliente || !texto) {
    res.status(400);
    throw new Error('cliente y texto son obligatorios');
  }
  const resena = await Resena.create({
    cliente, texto,
    calificacion: calificacion || 5,
    fuente: fuente || 'whatsapp',
    servicio: servicio || '',
    destacada: !!destacada,
    fecha: fecha ? new Date(fecha) : new Date(),
    capturadaPor: req.user?.name || '',
  });
  res.status(201).json(resena);
}));

router.put('/resenas/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const campos = ['cliente', 'texto', 'calificacion', 'fuente', 'servicio', 'destacada', 'visible', 'fecha'];
  const update = {};
  campos.forEach((c) => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
  const resena = await Resena.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!resena) { res.status(404); throw new Error('Reseña no encontrada'); }
  res.json(resena);
}));

router.delete('/resenas/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const resena = await Resena.findByIdAndDelete(req.params.id);
  if (!resena) { res.status(404); throw new Error('Reseña no encontrada'); }
  res.json({ ok: true });
}));

// ───────────────────────────────────────────────────
// GET /biblioteca/contexto-ia — paquete de conocimiento para Sofia
// Anonimizado: estadísticas reales del negocio, sin datos personales.
// Acceso: admin logueado o header x-biblioteca-token (n8n).
// ───────────────────────────────────────────────────
router.get('/contexto-ia', iaAuth, asyncHandler(async (req, res) => {
  const [quotes, resenas] = await Promise.all([
    GeneratedQuote.find({})
      .select('status paidAt precioConDescuento extensionEstimada tipoTrabajo tipoServicio area carrera tiempoEntrega esquemaTipo serviciosIncluidos createdAt')
      .lean(),
    Resena.find({ visible: true }).sort({ destacada: -1, fecha: -1 }).limit(12).lean(),
  ]);

  const pagadas = quotes.filter((q) => q.status === 'paid' || q.paidAt);
  const tickets = pagadas.map((q) => q.precioConDescuento || 0).filter(Boolean);
  const porPagina = pagadas
    .filter((q) => (q.extensionEstimada || 0) > 0 && (q.precioConDescuento || 0) > 0)
    .map((q) => ({ v: q.precioConDescuento / q.extensionEstimada, servicio: q.tipoServicio || 'integral' }));

  const ppGlobal = mediana(porPagina.map((x) => x.v));
  const ppPorServicio = {};
  porPagina.forEach((x) => { (ppPorServicio[x.servicio] = ppPorServicio[x.servicio] || []).push(x.v); });
  const precioPorPagina = Object.fromEntries(
    Object.entries(ppPorServicio).map(([k, arr]) => [k, Math.round(mediana(arr))])
  );

  const cuenta = (campo) => {
    const m = {};
    pagadas.forEach((q) => { const v = q[campo]; if (v) m[v] = (m[v] || 0) + 1; });
    return topN(m, 8);
  };
  const esquemas = {};
  pagadas.forEach((q) => { if (q.esquemaTipo) esquemas[q.esquemaTipo] = (esquemas[q.esquemaTipo] || 0) + 1; });
  const servicios = {};
  pagadas.forEach((q) => (q.serviciosIncluidos || []).forEach((s) => { servicios[s] = (servicios[s] || 0) + 1; }));

  const resenasPack = resenas.map((r) => ({
    cliente: String(r.cliente || '').split(/\s+/)[0], // solo nombre de pila
    calificacion: r.calificacion,
    texto: r.texto,
    servicio: r.servicio || '',
    fuente: r.fuente,
  }));

  const datos = {
    generadoEn: new Date().toISOString(),
    ventas: {
      proyectosCerradosHistoricos: pagadas.length,
      ticketMediano: Math.round(mediana(tickets)),
      precioPorPaginaMediano: Math.round(ppGlobal),
      precioPorPaginaPorServicio: precioPorPagina,
    },
    demanda: {
      tiposDeTrabajoMasVendidos: cuenta('tipoTrabajo'),
      areasMasAtendidas: cuenta('area'),
      carrerasMasAtendidas: cuenta('carrera'),
    },
    esquemasDePagoUsados: topN(esquemas, 8),
    serviciosIncluidosComunes: topN(servicios, 10),
    resenas: resenasPack,
  };

  // Bloque de texto listo para inyectar al prompt de Sofia
  const lineas = [];
  lineas.push('== CONTEXTO DE NEGOCIO TESIPEDIA (datos reales, uso interno del asistente) ==');
  lineas.push(`Proyectos cerrados históricos: ${datos.ventas.proyectosCerradosHistoricos}.`);
  lineas.push('Tesipedia asesora y acompaña proyectos de titulación; NUNCA menciones precios exactos sin cotización formal.');
  if (datos.demanda.tiposDeTrabajoMasVendidos.length) {
    lineas.push(`Trabajos más solicitados: ${datos.demanda.tiposDeTrabajoMasVendidos.map((t) => t.nombre).join(', ')}.`);
  }
  if (datos.demanda.areasMasAtendidas.length) {
    lineas.push(`Áreas con más experiencia: ${datos.demanda.areasMasAtendidas.map((t) => t.nombre).join(', ')}.`);
  }
  if (datos.demanda.carrerasMasAtendidas.length) {
    lineas.push(`Carreras frecuentes: ${datos.demanda.carrerasMasAtendidas.map((t) => t.nombre).join(', ')}.`);
  }
  if (datos.esquemasDePagoUsados.length) {
    lineas.push(`Esquemas de pago disponibles y usados por clientes reales: ${datos.esquemasDePagoUsados.map((e) => e.nombre).join(', ')}.`);
  }
  if (datos.serviciosIncluidosComunes.length) {
    lineas.push(`Servicios que normalmente se incluyen: ${datos.serviciosIncluidosComunes.map((s) => s.nombre).join(', ')}.`);
  }
  if (resenasPack.length) {
    lineas.push('Testimonios reales de clientes (úsalos con naturalidad para dar confianza, sin inventar otros):');
    resenasPack.slice(0, 6).forEach((r) => {
      lineas.push(`- ${r.cliente} (${'★'.repeat(r.calificacion || 5)}${r.servicio ? `, ${r.servicio}` : ''}): "${r.texto}"`);
    });
  }
  lineas.push('== FIN DEL CONTEXTO ==');

  res.json({ ...datos, textoPlano: lineas.join('\n') });
}));

export default router;
