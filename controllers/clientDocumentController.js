import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';
import ClientDocument from '../models/ClientDocument.js';
import { ensureClientAccess } from '../utils/clientAccess.js';

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

/* ─────────── procesar + guardar (estado BLOQUEADO) ─────────── */
async function processLocked(docId, pdfBuffer, watermark) {
  const { buildLockedPreview } = await loadPdfProtect();
  const { numPages, refStartPage, images } = await buildLockedPreview(pdfBuffer, { watermark });
  const folder = `tesipedia/client-docs/${docId}/preview`;
  const pages = [];
  for (const img of images) {
    const r = await uploadBuffer(img.buffer, { folder, resource_type: 'image', format: 'jpg' });
    pages.push({ publicId: r.public_id, width: img.width, height: img.height, page: img.page });
  }
  // original limpio (para descarga al liberar)
  const orig = await uploadBuffer(pdfBuffer, { folder: `tesipedia/client-docs/${docId}`, resource_type: 'raw', format: 'pdf' });
  await ClientDocument.findByIdAndUpdate(docId, {
    status: 'locked', numPages, refStartPage, pages,
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

// POST /client-docs/:id/unlock  → genera imágenes limpias + habilita descarga del original
export const unlockClientDocument = asyncHandler(async (req, res) => {
  const doc = await ClientDocument.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('Documento no encontrado'); }
  if (!doc.original?.publicId) { res.status(400); throw new Error('No hay original para liberar'); }

  // Descargar el original desde Cloudinary para re-renderizar limpio
  const url = signedUrl(doc.original.publicId, 'raw');
  const resp = await fetch(url);
  if (!resp.ok) { res.status(500); throw new Error('No se pudo leer el original'); }
  const pdfBuffer = Buffer.from(await resp.arrayBuffer());

  const { buildCleanImages } = await loadPdfProtect();
  const { images } = await buildCleanImages(pdfBuffer);
  const folder = `tesipedia/client-docs/${doc._id}/clean`;
  const cleanPages = [];
  for (const img of images) {
    const r = await uploadBuffer(img.buffer, { folder, resource_type: 'image', format: 'jpg' });
    cleanPages.push({ publicId: r.public_id, width: img.width, height: img.height, page: img.page });
  }
  doc.cleanPages = cleanPages;
  doc.status = 'unlocked';
  doc.unlockedAt = new Date();
  await doc.save();
  res.json({ id: String(doc._id), status: doc.status, cleanPages: cleanPages.length });
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
  await destroyAssets([...doc.pages, ...doc.cleanPages].map((p) => p.publicId), 'image');
  await destroyAssets([doc.original?.publicId], 'raw');
  await doc.deleteOne();
  res.json({ ok: true });
});

/* ═════════ PORTAL (cliente autenticado) ═════════ */

// GET /portal/documents  → lista los documentos del cliente logueado
export const getMyDocuments = asyncHandler(async (req, res) => {
  const docs = await ClientDocument.find({ client: req.user._id }).sort({ createdAt: -1 }).lean();
  res.json(docs.map((d) => ({
    id: String(d._id), title: d.title, status: d.status,
    numPages: d.numPages,
    visiblePages: d.status === 'unlocked' ? d.cleanPages.length : d.pages.length,
    locked: d.status !== 'unlocked',
  })));
});

// GET /portal/documents/:id  → páginas (URLs firmadas) según estado + descarga si liberado
export const getDocumentForClient = asyncHandler(async (req, res) => {
  const doc = await ClientDocument.findOne({ _id: req.params.id, client: req.user._id }).lean();
  if (!doc) { res.status(404); throw new Error('Documento no encontrado'); }
  const unlocked = doc.status === 'unlocked';
  const src = unlocked ? doc.cleanPages : doc.pages;
  res.json({
    id: String(doc._id), title: doc.title, status: doc.status, locked: !unlocked,
    numPages: doc.numPages,
    watermark: unlocked ? '' : doc.watermark,
    pages: src.map((p) => ({ page: p.page, width: p.width, height: p.height, url: signedUrl(p.publicId, 'image') })),
    download: unlocked && doc.original?.publicId ? signedUrl(doc.original.publicId, 'raw') : null,
  });
});

export default {
  uploadClientDocument, unlockClientDocument, listClientDocumentsAdmin,
  deleteClientDocument, getMyDocuments, getDocumentForClient,
};
