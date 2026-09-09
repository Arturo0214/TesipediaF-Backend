import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import GuidePurchase from '../models/GuidePurchase.js';
import { GUIA_PRODUCTOS, getProducto } from '../config/guiaProductos.js';
import { crearCheckout, crearCheckoutCart, verificarPago, mpWebhook, metodosDisponibles } from '../lib/guiaPagos.js';
import { signedRawUrl } from '../lib/cloudinary.js';
import { protect } from '../middleware/authMiddleware.js';
import sendEmail from '../utils/emailSender.js';

const FRONT = (process.env.CLIENT_URL || process.env.FRONT_URL || 'https://tesipedia.com').replace(/\/$/, '');
const API_BASE = (process.env.PUBLIC_API_URL || process.env.BACKEND_URL || 'https://api.tesipedia.com').replace(/\/$/, '');
const DOWNLOAD_DAYS = 30;
const MAX_CART_ITEMS = 30; // techo defensivo del carrito

const router = express.Router();

// Solo acepta strings simples; bloquea operadores NoSQL ({$ne}, {$gt}, arrays, etc.).
const strParam = (v) => (typeof v === 'string' ? v.trim() : '');

// Rate limiters dedicados a la tienda (además del generalLimiter global).
// Evitan spam de preferencias y, sobre todo, fuerza bruta/enumeración de refs y tokens.
const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  message: { error: 'Demasiados intentos de pago. Intenta de nuevo en unos minutos.' },
  standardHeaders: true, legacyHeaders: false,
});
const verifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 40,
  message: { error: 'Demasiadas verificaciones. Espera un momento.' },
  standardHeaders: true, legacyHeaders: false,
});

// Vista pública de un producto (sin exponer los public_id privados de la completa).
const publicProducto = (p) => ({
  id: p.id,
  sku: p.sku || null,
  tipo: p.tipo,
  nombre: p.nombre,
  kicker: p.kicker || '',
  resumen: p.resumen,
  precio: p.precio,
  currency: p.currency || 'MXN',
  destacado: Boolean(p.destacado),
  muestraUrl: p.muestraUrl || null,
  pages: p.pages || [],
  incluye: p.incluye || p.archivos.map((a) => a.label),
});

/* ───────────── Catálogo ───────────── */
router.get('/productos', (req, res) => {
  res.json({
    metodos: metodosDisponibles(),
    productos: Object.values(GUIA_PRODUCTOS).map(publicProducto),
  });
});

router.get('/productos/:id', (req, res) => {
  const p = getProducto(req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ metodos: metodosDisponibles(), producto: publicProducto(p) });
});

/* ───────────── Muestra gratis (Cloudinary público) ───────────── */
router.get('/muestra/:id', (req, res) => {
  const p = getProducto(req.params.id);
  if (!p || !p.muestraUrl) return res.status(404).json({ error: 'Muestra no disponible' });
  res.redirect(302, p.muestraUrl);
});

/* ───────────── Crear checkout ───────────── */
router.post('/checkout', checkoutLimiter, async (req, res) => {
  try {
    const productId = strParam(req.body?.productId);
    const email = strParam(req.body?.email).toLowerCase();
    const metodo = strParam(req.body?.metodo) || 'mercadopago';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Correo inválido.' });
    }
    // El precio SIEMPRE se resuelve en el backend a partir del productId (nunca del cliente).
    const { url } = await crearCheckout({ productId, email, metodo });
    res.json({ url });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo iniciar el pago.' });
  }
});

/* ───────────── Checkout de CARRITO (varias guías/paquetes) ───────────── */
router.post('/checkout-cart', checkoutLimiter, async (req, res) => {
  try {
    const rawItems = req.body?.items;
    const email = strParam(req.body?.email).toLowerCase();
    const metodo = strParam(req.body?.metodo) || 'mercadopago';
    if (!Array.isArray(rawItems) || !rawItems.length) return res.status(400).json({ error: 'Tu carrito está vacío.' });
    // Solo ids string, sin duplicados y con techo defensivo.
    const items = [...new Set(rawItems.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))].slice(0, MAX_CART_ITEMS);
    if (!items.length) return res.status(400).json({ error: 'Tu carrito está vacío.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Correo inválido.' });
    const { url } = await crearCheckoutCart({ items, email, metodo });
    res.json({ url });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo iniciar el pago.' });
  }
});

// Archivos a entregar por una compra: unión de los de todos los items (carrito) o del producto único.
function archivosDe(purchase) {
  if (purchase.items && purchase.items.length) {
    return purchase.items.flatMap((id) => (getProducto(id)?.archivos || []));
  }
  return getProducto(purchase.productId)?.archivos || [];
}

function nombreDe(purchase) {
  if (purchase.items && purchase.items.length) {
    return purchase.items.map((id) => getProducto(id)?.nombre || id).join(' + ');
  }
  return getProducto(purchase.productId)?.nombre || purchase.productId;
}

/* ───────────── Persistir compra + entregar (idempotente por ref) ───────────── */
async function registrarCompra({ productId, items = [], email, monto, provider, ref }) {
  if (!productId || !email || !ref) return null;
  const p = getProducto(productId);
  const nombre = (items && items.length) ? items.map((id) => getProducto(id)?.nombre || id).join(' + ') : (p?.nombre || productId);
  const existing = await GuidePurchase.findOne({ ref });
  if (existing && existing.status === 'paid') return existing; // ya procesado

  const token = existing?.downloadToken || crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + DOWNLOAD_DAYS * 24 * 60 * 60 * 1000);

  const purchase = await GuidePurchase.findOneAndUpdate(
    { ref },
    {
      productId,
      items: items || [],
      productName: nombre,
      email: String(email).toLowerCase().trim(),
      amount: monto || p?.precio || 0,
      currency: p?.currency || 'MXN',
      provider,
      ref,
      status: 'paid',
      downloadToken: token,
      expiresAt,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (!purchase.emailedAt) {
    try {
      await enviarGuiaEmail(purchase);
      purchase.emailedAt = new Date();
      await purchase.save();
    } catch (e) {
      console.error('[guias] error enviando email:', e.message);
    }
  }
  return purchase;
}

async function enviarGuiaEmail(purchase) {
  const archivos = archivosDe(purchase);
  const nombre = nombreDe(purchase);
  if (!archivos.length) return;
  const base = `${FRONT}/guias/gracias?product=${purchase.productId}&token=${purchase.downloadToken}`;
  const links = archivos.map((a, idx) => {
    const url = `${API_BASE}/guias/descargar/${purchase.downloadToken}/${idx}`;
    return `<li style="margin:6px 0"><a href="${url}" style="color:#1D4ED8;font-weight:600">${a.label}</a></li>`;
  }).join('');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0B2150">
      <h2 style="color:#071A3A">¡Gracias por tu compra! 🎓</h2>
      <p>Aquí tienes <strong>${nombre}</strong>. Puedes descargar tus archivos con estos enlaces (válidos ${DOWNLOAD_DAYS} días):</p>
      <ul style="padding-left:18px">${links}</ul>
      <p>También puedes acceder desde esta página:</p>
      <p><a href="${base}" style="display:inline-block;background:#1FA855;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Ver mis descargas</a></p>
      <p style="color:#5A6B85;font-size:13px;margin-top:24px">Si tienes cualquier duda, responde a este correo y te ayudamos. — Equipo Tesipedia</p>
    </div>`;
  await sendEmail({
    to: purchase.email,
    subject: `Tu descarga: ${nombre} — Tesipedia`,
    text: `Gracias por tu compra de "${nombre}". Accede a tus descargas en: ${base}`,
    html,
  });
}

/* ───────────── Verificar pago (página de gracias, back_url) ───────────── */
router.get('/verificar', verifyLimiter, async (req, res) => {
  try {
    // Coerción a string: bloquea inyección de operadores NoSQL en query (?token[$ne]=…).
    const proveedor = strParam(req.query.proveedor);
    const ref = strParam(req.query.ref);
    const token = strParam(req.query.token);
    const product = strParam(req.query.product);

    if (token) {
      const purchase = await GuidePurchase.findOne({ downloadToken: token });
      if (!purchase || purchase.status !== 'paid') return res.status(404).json({ pagado: false });
      return res.json(respuestaCompra(purchase));
    }

    if (!proveedor || !ref) return res.status(400).json({ error: 'Faltan datos de verificación.' });
    const info = await verificarPago({ proveedor, ref });
    if (!info.pagado) return res.json({ pagado: false });

    const purchase = await registrarCompra({
      productId: info.productId || product,
      items: info.items || [],
      email: info.email,
      monto: info.monto,
      provider: info.provider,
      ref: info.ref,
    });
    if (!purchase) return res.status(500).json({ error: 'No se pudo registrar la compra.' });
    res.json(respuestaCompra(purchase));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Error al verificar el pago.' });
  }
});

function respuestaCompra(purchase) {
  return {
    pagado: true,
    productId: purchase.productId,
    productName: purchase.productName || nombreDe(purchase),
    email: purchase.email,
    emailed: Boolean(purchase.emailedAt),
    token: purchase.downloadToken,
    archivos: archivosDe(purchase).map((a, idx) => ({
      label: a.label,
      url: `${API_BASE}/guias/descargar/${purchase.downloadToken}/${idx}`,
    })),
  };
}

/* ───────────── Descarga con token → URL firmada de Cloudinary ───────────── */
router.get('/descargar/:token/:idx?', verifyLimiter, async (req, res) => {
  try {
    const token = strParam(req.params.token);
    const idx = Number.parseInt(req.params.idx ?? '0', 10);
    if (!token || Number.isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Solicitud inválida.' });
    const purchase = await GuidePurchase.findOne({ downloadToken: token });
    if (!purchase || purchase.status !== 'paid') return res.status(403).json({ error: 'Descarga no autorizada.' });
    if (purchase.expiresAt && purchase.expiresAt < new Date()) {
      return res.status(410).json({ error: 'El enlace de descarga expiró. Escríbenos y te reactivamos el acceso.' });
    }
    const archivo = archivosDe(purchase)[idx];
    if (!archivo || !archivo.publicId) return res.status(404).json({ error: 'Archivo no disponible todavía.' });

    const url = signedRawUrl(archivo.publicId);
    if (!url) return res.status(503).json({ error: 'Entrega no configurada.' });

    purchase.downloadCount = (purchase.downloadCount || 0) + 1;
    await purchase.save();
    res.redirect(302, url);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo descargar el archivo.' });
  }
});

/* ───────────── Mis guías (cliente logueado) ───────────── */
router.get('/mis-compras', protect, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(401).json({ error: 'No autorizado' });
    const compras = await GuidePurchase.find({ email, status: 'paid' }).sort({ createdAt: -1 });
    res.json(compras.map((c) => ({
      productId: c.productId,
      productName: c.productName || nombreDe(c),
      fecha: c.createdAt,
      expiresAt: c.expiresAt,
      archivos: archivosDe(c).map((a, idx) => ({
        label: a.label,
        url: `${API_BASE}/guias/descargar/${c.downloadToken}/${idx}`,
      })),
    })));
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron cargar tus guías.' });
  }
});

/* ───────────── Webhook MercadoPago ───────────── */
router.post('/webhook/mp', (req, res) => mpWebhook(req, res, registrarCompra));

export default router;
