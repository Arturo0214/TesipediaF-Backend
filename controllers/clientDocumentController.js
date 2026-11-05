import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';
import ClientDocument from '../models/ClientDocument.js';
import GeneratedQuote from '../models/GeneratedQuote.js';
import Project from '../models/Project.js';
import Seguimiento from '../models/Seguimiento.js';
import { ensureClientAccess } from '../utils/clientAccess.js';
import { buildInstallments } from '../utils/quoteSchedule.js';

// Estado de pago del documento (según su cotización ligada).
// Regla del cliente: si NO ha pagado nada → no puede ver. Si pagó → ve con marca de agua.
async function estadoPago(doc) {
  if (!doc.quote) return { pagado: 0, total: 0, haPagado: true, liquidado: false }; // sin cotización ligada: no bloquear
  const q = await GeneratedQuote.findById(doc.quote).lean();
  if (!q) return { pagado: 0, total: 0, haPagado: true, liquidado: false };
  const insts = buildInstallments(q);
  const pagado = insts.filter((i) => i.status === 'paid').reduce((t, i) => t + (i.amount || 0), 0);
  const total = insts.reduce((t, i) => t + (i.amount || 0), 0);
  return { pagado, total, haPagado: pagado > 0.5, liquidado: total > 0 && pagado >= total - 0.5 };
}

// pdfProtect usa @napi-rs/canvas (binario nativo): carga DIFERIDA para que un fallo
// de carga del binario no tumbe todo el servidor al arrancar — solo afecta el
// procesamiento de documentos.
const loadPdfProtect = () => import('../utils/pdfProtect.js');

/* ─────────── helpers Cloudinary (type: authenticated = no accesible por URL adivinable) ─────────── */
const uploadBuffer = (buffer, { folder, resource_type = 'image', format }) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type, type: 'authenticated', format, transformation: [] },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

// URL firmada (solo se entrega al dueño autenticado; no se puede adivinar ni modificar)
const signedUrl = (publicId, resource_type = 'image') =>
  cloudinary.url(publicId, { type: 'authenticated', resource_type, sign_url: true, secure: true });

const destroyAssets = async (publicIds, resource_type = 'image') => {
  for (const id of publicIds.filter(Boolean)) {
    try { await cloudinary.uploader.destroy(id, { type: 'authenticated', resource_type }); } catch { /* noop */ }
  }
};

/* ─────────── procesar + guardar (estado BLOQUEADO) ───────────
 * Genera un PDF de vista protegido (marca de agua + censura + sin referencias)
 * y guarda también el original limpio para descarga al liberar. */
async function processLocked(docId, pdfBuffer, watermark) {
  const { buildViewPdf } = await loadPdfProtect();
  const { numPages, refStartPage, pdf } = await buildViewPdf(pdfBuffer, { watermark });
  const view = await uploadBuffer(pdf, { folder: `tesipedia/client-docs/${docId}/view`, resource_type: 'raw', format: 'pdf' });
  const orig = await uploadBuffer(pdfBuffer, { folder: `tesipedia/client-docs/${docId}`, resource_type: 'raw', format: 'pdf' });
  await ClientDocument.findByIdAndUpdate(docId, {
    status: 'locked', numPages, refStartPage, pages: [],
    viewPdf: { publicId: view.public_id, bytes: pdf.length },
    original: { publicId: orig.public_id, bytes: pdfBuffer.length },
    error: '',
  });
}

/* ═════════ ADMIN ═════════ */

// POST /client-docs  (multipart: file + datos del cliente/proyecto)
export const uploadClientDocument = asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400); throw new Error('Falta el archivo PDF'); }
  if (req.file.mimetype !== 'application/pdf') { res.status(400); throw new Error('El documento debe ser PDF'); }
  const { clientName, clientEmail, clientPhone, quoteId, projectId, title } = req.body || {};

  const access = await ensureClientAccess({ clientName, clientEmail, clientPhone, projectTitle: title });
  if (!access) { res.status(400); throw new Error('No se pudo resolver la cuenta del cliente (email o teléfono)'); }

  const watermark = (req.body.watermark || `TESIPEDIA · ${access.clientNumber ? `Cliente #${access.clientNumber}` : (clientName || '')} · MUESTRA`).trim();

  const doc = await ClientDocument.create({
    client: access.userId,
    quote: quoteId || null,
    project: projectId || null,
    title: title || req.file.originalname?.replace(/\.pdf$/i, '') || 'Documento',
    status: 'processing',
    watermark,
    uploadedBy: req.user?.name || 'admin',
  });

  try {
    await processLocked(doc._id, req.file.buffer, watermark);
  } catch (err) {
    console.error('[ClientDoc] Error procesando PDF:', err);
    await ClientDocument.findByIdAndUpdate(doc._id, { status: 'error', error: err.message });
    res.status(500); throw new Error('No se pudo procesar el PDF: ' + err.message);
  }

  const fresh = await ClientDocument.findById(doc._id).lean();
  res.status(201).json({
    id: String(fresh._id), title: fresh.title, status: fresh.status,
    numPages: fresh.numPages, previewPages: fresh.pages.length, refStartPage: fresh.refStartPage,
    client: { userId: access.userId, nombre: access.nombre, clientNumber: access.clientNumber, loginId: access.loginId },
  });
});

// POST /client-docs/:id/unlock  → libera: el cliente ve/descarga el PDF original limpio
export const unlockClientDocument = asyncHandler(async (req, res) => {
  const doc = await ClientDocument.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('Documento no encontrado'); }
  if (!doc.original?.publicId) { res.status(400); throw new Error('No hay original para liberar'); }
  doc.status = 'unlocked';
  doc.unlockedAt = new Date();
  await doc.save();
  res.json({ id: String(doc._id), status: doc.status });
});

// GET /client-docs?quoteId=&projectId=&clientId=   (admin: listar)
export const listClientDocumentsAdmin = asyncHandler(async (req, res) => {
  const { quoteId, projectId, clientId } = req.query;
  const q = {};
  if (quoteId) q.quote = quoteId;
  if (projectId) q.project = projectId;
  if (clientId) q.client = clientId;
  if (!Object.keys(q).length) { res.json([]); return; }
  const docs = await ClientDocument.find(q).sort({ createdAt: -1 }).lean();
  res.json(docs.map((d) => ({
    id: String(d._id), title: d.title, status: d.status, numPages: d.numPages,
    previewPages: d.pages.length, cleanPages: d.cleanPages.length, refStartPage: d.refStartPage,
    createdAt: d.createdAt, unlockedAt: d.unlockedAt,
  })));
});

// DELETE /client-docs/:id
export const deleteClientDocument = asyncHandler(async (req, res) => {
  const doc = await ClientDocument.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('No encontrado'); }
  await destroyAssets([...(doc.pages || []), ...(doc.cleanPages || [])].map((p) => p.publicId), 'image');
  await destroyAssets([doc.original?.publicId, doc.viewPdf?.publicId], 'raw');
  await doc.deleteOne();
  res.json({ ok: true });
});

/* ═════════ PORTAL (cliente autenticado) ═════════ */

// GET /portal/documents  → lista los documentos del cliente logueado
export const getMyDocuments = asyncHandler(async (req, res) => {
  const docs = await ClientDocument.find({ client: req.user._id }).sort({ createdAt: -1 }).lean();
  const out = await Promise.all(docs.map(async (d) => {
    const pago = await estadoPago(d);
    return {
      id: String(d._id), title: d.title, status: d.status,
      numPages: d.numPages,
      visiblePages: d.status === 'unlocked' ? d.numPages : (d.refStartPage ? d.refStartPage - 1 : d.numPages),
      locked: d.status !== 'unlocked',
      cannotView: d.status !== 'unlocked' && !pago.haPagado,   // liberado = siempre visible; si no, requiere pago
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }));
  res.json(out);
});

// GET /portal/final-files → documentos FINALES subidos por el equipo en el board de
// Proyectos (modelo Seguimiento, rol: 'final'). Se liberan al cliente SIN marca de agua
// a partir de su SEGUNDO pago (2+ parcialidades pagadas) o si ya liquidó. Antes: bloqueados.
// Puente que antes no existía: el board guardaba los finales pero nunca llegaban al portal.
const asAttachment = (url) =>
  url && url.includes('/upload/') ? url.replace('/upload/', '/upload/fl_attachment/') : url;

// Etiqueta de entrega para el cliente (mismo modelo que el admin): el 1er pago es
// adelanto, 1ª entrega = 2º pago…; 101,102… = Correcciones 1,2…; null = 1ª entrega.
const ORD_ENT_FF = ['', '1ª', '2ª', '3ª', '4ª', '5ª', '6ª', '7ª', '8ª', '9ª', '10ª'];
const labelEntrega = (value, nPagos) => {
  const v = value == null ? 1 : Number(value);
  if (v >= 101) return `Correcciones ${v - 100}`;
  const numEnt = nPagos <= 1 ? 1 : nPagos - 1;
  return numEnt === 1 ? 'Entrega' : `${ORD_ENT_FF[v] || `${v}ª`} entrega`;
};

const contarPagadas = async (seg) => {
  // Preferir las parcialidades de la cotización (ahí marca el admin el estado real).
  if (seg.quote) {
    const q = await GeneratedQuote.findById(seg.quote).lean();
    if (q) {
      const insts = buildInstallments(q);
      const paidCount = insts.filter((i) => i.status === 'paid').length;
      const total = insts.reduce((t, i) => t + (i.amount || 0), 0);
      const paid = insts.filter((i) => i.status === 'paid').reduce((t, i) => t + (i.amount || 0), 0);
      return { paidCount, liquidado: total > 0 && paid >= total - 0.5, nPagos: insts.length };
    }
  }
  // Fallback: calendario del pago ligado al proyecto.
  if (seg.project) {
    const p = await Project.findById(seg.project).populate('payment', 'schedule amount').lean();
    const sched = p?.payment?.schedule || [];
    const paidCount = sched.filter((s) => s.status === 'paid').length;
    const total = sched.reduce((t, s) => t + (s.amount || 0), 0);
    const paid = sched.filter((s) => s.status === 'paid').reduce((t, s) => t + (s.amount || 0), 0);
    return { paidCount, liquidado: total > 0 && paid >= total - 0.5, nPagos: sched.length };
  }
  return { paidCount: 0, liquidado: false, nPagos: 1 };
};

export const getMyFinalFiles = asyncHandler(async (req, res) => {
  const projects = await Project.find({ client: req.user._id }).select('_id generatedQuote').lean();
  const quoteIds = projects.map((p) => p.generatedQuote).filter(Boolean);
  const projectIds = projects.map((p) => p._id);
  if (!quoteIds.length && !projectIds.length) return res.json([]);

  const segs = await Seguimiento.find({
    $or: [{ quote: { $in: quoteIds } }, { project: { $in: projectIds } }],
  }).lean();

  const out = [];
  for (const seg of segs) {
    const finales = (seg.archivos || []).filter((a) => a.rol === 'final');
    if (!finales.length) continue;
    const { paidCount, liquidado, nPagos } = await contarPagadas(seg);
    const unlocked = seg.docLiberado || paidCount >= 2 || liquidado;
    finales.forEach((a, idx) => {
      const ext = (a.nombre || '').split('.').pop()?.toLowerCase() || '';
      const editable = ['doc', 'docx', 'rtf', 'odt'].includes(ext);
      out.push({
        id: `seg:${seg._id}:${idx}`,
        title: a.nombre || 'Documento final',
        ext,
        tipo: a.tipo || '',
        editable,
        entrega: a.entrega ?? 1,
        entregaLabel: labelEntrega(a.entrega, nPagos),
        createdAt: a.subidoEn || seg.updatedAt,
        isBoardFile: true,
        locked: !unlocked,
        download: unlocked ? asAttachment(a.url) : null,
        message: unlocked ? '' : 'Disponible sin marca de agua al realizar tu segundo pago.',
      });
    });
  }
  out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(out);
});

// GET /portal/documents/:id  → páginas (URLs firmadas) según estado + descarga si liberado
export const getDocumentForClient = asyncHandler(async (req, res) => {
  const doc = await ClientDocument.findOne({ _id: req.params.id, client: req.user._id }).lean();
  if (!doc) { res.status(404); throw new Error('Documento no encontrado'); }
  const pago = await estadoPago(doc);
  // Candado por pago: si no ha pagado nada, NO puede ver el documento (salvo que ya
  // esté liberado/unlocked por el equipo).
  if (!pago.haPagado && doc.status !== 'unlocked') {
    res.json({
      id: String(doc._id), title: doc.title, status: doc.status, locked: true, cannotView: true,
      numPages: doc.numPages, pages: [], download: null,
      message: 'Realiza tu primer pago para desbloquear la lectura de tu documento.',
    });
    return;
  }
  const unlocked = doc.status === 'unlocked';
  // Liberado → PDF limpio (original). Bloqueado → PDF de vista protegido (marca agua + censura + sin refs).
  const viewId = unlocked ? (doc.original?.publicId) : (doc.viewPdf?.publicId || doc.original?.publicId);
  res.json({
    id: String(doc._id), title: doc.title, status: doc.status, locked: !unlocked, cannotView: false,
    numPages: doc.numPages,
    pdfUrl: viewId ? signedUrl(viewId, 'raw') : null,
    download: unlocked && doc.original?.publicId ? signedUrl(doc.original.publicId, 'raw') : null,
  });
});

export default {
  uploadClientDocument, unlockClientDocument, listClientDocumentsAdmin,
  deleteClientDocument, getMyDocuments, getDocumentForClient, getMyFinalFiles,
};
