// Pagos de guías digitales — MercadoPago (+ Stripe opcional), activados por env.
// Patrón blindado (replicado de Contratado):
//  · Sin llaves configuradas → 503 con mensaje claro. El código queda listo.
//  · El importe/estado NUNCA se toman del cuerpo del webhook: se consultan a la
//    API del proveedor con el id recibido (fuente de verdad).
//  · Si MP_WEBHOOK_SECRET está configurado, se valida la firma x-signature.

import { getProducto } from '../config/guiaProductos.js';

const FRONT = (process.env.CLIENT_URL || process.env.FRONT_URL || 'https://tesipedia.com').replace(/\/$/, '');
const API = (process.env.PUBLIC_API_URL || process.env.BACKEND_URL || 'https://api.tesipedia.com').replace(/\/$/, '');

// Tesipedia ya tiene configurado MERCADOPAGO_ACCESS_TOKEN; aceptamos también el alias MP_ACCESS_TOKEN.
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET || '';

// ── Clientes perezosos ──────────────────────────────────────────────
let stripe = null;
async function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripe) {
    const { default: Stripe } = await import('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

let mpPreference = null;
let mpPayment = null;
async function getMp() {
  if (!MP_TOKEN) return null;
  if (!mpPreference) {
    const { MercadoPagoConfig, Preference, Payment } = await import('mercadopago');
    const cfg = new MercadoPagoConfig({ accessToken: MP_TOKEN });
    mpPreference = new Preference(cfg);
    mpPayment = new Payment(cfg);
  }
  return { preference: mpPreference, payment: mpPayment };
}

export function metodosDisponibles() {
  return {
    mercadopago: Boolean(MP_TOKEN),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
  };
}

const urlExito = (productId, prov) => `${FRONT}/guias/gracias?product=${productId}&proveedor=${prov}`;
const urlCancel = (productId) => `${FRONT}/guias/${productId}?cancelado=1`;

// ── Crear checkout (pago único) ─────────────────────────────────────
export async function crearCheckout({ productId, email, metodo }) {
  const p = getProducto(productId);
  if (!p) throw Object.assign(new Error('Producto inválido'), { status: 400 });
  if (!email) throw Object.assign(new Error('Necesitamos tu correo para enviarte la guía.'), { status: 400 });

  if (metodo === 'mercadopago') {
    const mp = await getMp();
    if (!mp) throw Object.assign(new Error('MercadoPago no configurado (MP_ACCESS_TOKEN)'), { status: 503 });
    const pref = await mp.preference.create({
      body: {
        items: [{
          id: productId, title: p.nombre, quantity: 1,
          unit_price: p.precio, currency_id: p.currency || 'MXN', description: 'Guía digital Tesipedia',
        }],
        payer: { email },
        metadata: { productId, email },
        external_reference: `${productId}|${email}`,
        statement_descriptor: 'TESIPEDIA',
        notification_url: API ? `${API}/guias/webhook/mp` : undefined,
        back_urls: {
          success: urlExito(productId, 'mp'),
          pending: urlExito(productId, 'mp'),
          failure: urlCancel(productId),
        },
        auto_return: 'approved',
      },
    });
    return { url: pref.init_point };
  }

  if (metodo === 'stripe') {
    const s = await getStripe();
    if (!s) throw Object.assign(new Error('Stripe no configurado (STRIPE_SECRET_KEY)'), { status: 503 });
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (p.currency || 'mxn').toLowerCase(),
          unit_amount: p.precio * 100,
          product_data: { name: p.nombre },
        },
      }],
      metadata: { productId, email },
      success_url: `${urlExito(productId, 'stripe')}&ref={CHECKOUT_SESSION_ID}`,
      cancel_url: urlCancel(productId),
    });
    return { url: session.url };
  }

  throw Object.assign(new Error('Método inválido'), { status: 400 });
}

// ── Crear checkout de CARRITO (varias guías/paquetes en un pago) ─────
export async function crearCheckoutCart({ items, email, metodo }) {
  // Solo ids string, deduplicados y acotados (defensa en profundidad; la ruta ya sanea).
  const ids0 = [...new Set((items || []).filter((x) => typeof x === 'string'))].slice(0, 30);
  const productos = ids0.map(getProducto).filter(Boolean);
  if (!productos.length) throw Object.assign(new Error('Tu carrito está vacío.'), { status: 400 });
  if (!email) throw Object.assign(new Error('Necesitamos tu correo para enviarte las guías.'), { status: 400 });
  const ids = productos.map((p) => p.id);
  const successBase = `${FRONT}/guias/gracias?proveedor=`;
  const cancel = `${FRONT}/guias?cancelado=1`;

  if (metodo === 'mercadopago') {
    const mp = await getMp();
    if (!mp) throw Object.assign(new Error('MercadoPago no configurado'), { status: 503 });
    const pref = await mp.preference.create({
      body: {
        items: productos.map((p) => ({ id: p.id, title: p.nombre, quantity: 1, unit_price: p.precio, currency_id: p.currency || 'MXN', description: 'Guía digital Tesipedia' })),
        payer: { email },
        metadata: { items: ids.join(','), email },
        external_reference: `cart:${ids.join(',')}|${email}`,
        statement_descriptor: 'TESIPEDIA',
        notification_url: API ? `${API}/guias/webhook/mp` : undefined,
        back_urls: { success: `${successBase}mp`, pending: `${successBase}mp`, failure: cancel },
        auto_return: 'approved',
      },
    });
    return { url: pref.init_point };
  }

  if (metodo === 'stripe') {
    const s = await getStripe();
    if (!s) throw Object.assign(new Error('Stripe no configurado'), { status: 503 });
    const session = await s.checkout.sessions.create({
      mode: 'payment', customer_email: email,
      line_items: productos.map((p) => ({ quantity: 1, price_data: { currency: (p.currency || 'mxn').toLowerCase(), unit_amount: p.precio * 100, product_data: { name: p.nombre } } })),
      metadata: { items: ids.join(','), email },
      success_url: `${successBase}stripe&ref={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel,
    });
    return { url: session.url };
  }
  throw Object.assign(new Error('Método inválido'), { status: 400 });
}

// Extrae { isCart, items, productId } de un external_reference / metadata.
function parseRef(externalRef, metaItems) {
  const raw = String(externalRef || '|');
  const [refPart, emailPart] = raw.split('|');
  const isCart = refPart.startsWith('cart:') || Boolean(metaItems);
  const items = isCart
    ? String(metaItems || refPart.slice(5)).split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return { isCart, items, productId: isCart ? 'cart' : refPart, emailPart };
}

// ── Verificar un pago por su referencia (para la página de gracias) ──
export async function verificarPago({ proveedor, ref }) {
  if (proveedor === 'mp') {
    const mp = await getMp();
    if (!mp) throw Object.assign(new Error('MercadoPago no configurado'), { status: 503 });
    const pago = await mp.payment.get({ id: ref });
    const { isCart, items, productId, emailPart } = parseRef(pago.external_reference, pago.metadata?.items);
    return {
      pagado: pago.status === 'approved',
      productId: isCart ? 'cart' : (pago.metadata?.product_id || pago.metadata?.productId || productId || null),
      items,
      email: pago.metadata?.email || pago.payer?.email || emailPart || null,
      monto: pago.transaction_amount || 0,
      provider: 'mercadopago',
      ref: String(pago.id),
    };
  }
  if (proveedor === 'stripe') {
    const s = await getStripe();
    if (!s) throw Object.assign(new Error('Stripe no configurado'), { status: 503 });
    const session = await s.checkout.sessions.retrieve(ref);
    const metaItems = session.metadata?.items;
    const items = metaItems ? String(metaItems).split(',').map((x) => x.trim()).filter(Boolean) : [];
    return {
      pagado: session.payment_status === 'paid',
      productId: items.length ? 'cart' : (session.metadata?.productId || null),
      items,
      email: session.metadata?.email || session.customer_details?.email || session.customer_email || null,
      monto: (session.amount_total || 0) / 100,
      provider: 'stripe',
      ref: session.id,
    };
  }
  throw Object.assign(new Error('Proveedor inválido'), { status: 400 });
}

// ── Webhook de MercadoPago (IPN v2) ─────────────────────────────────
// `registrar({ productId, email, monto, provider, ref })` persiste + entrega.
export async function mpWebhook(req, res, registrar) {
  const mp = await getMp();
  if (!mp) return res.status(503).json({ error: 'MercadoPago no configurado' });

  const tipo = String(req.body?.type || req.body?.topic || req.query.type || req.query.topic || '');
  const dataId = req.body?.data?.id || req.query['data.id'] || req.query.id;
  const reconocido = /payment/i.test(tipo) || !tipo;
  if (!dataId || !reconocido) return res.status(200).json({ ignored: true });

  // Validación de firma (recomendada). Manifest: id:<>;request-id:<>;ts:<>;
  if (MP_WEBHOOK_SECRET) {
    try {
      const sig = String(req.headers['x-signature'] || '');
      const reqId = String(req.headers['x-request-id'] || '');
      const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=').map((x) => x.trim())));
      const ts = parts.ts; const v1 = parts.v1;
      const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
      const { createHmac } = await import('node:crypto');
      const hmac = createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
      if (!ts || !v1 || hmac !== v1) {
        console.warn('[guias mp webhook] firma inválida — rechazado.');
        return res.status(401).json({ error: 'Firma inválida' });
      }
    } catch (e) {
      return res.status(400).json({ error: `Firma inválida: ${e.message}` });
    }
  }

  try {
    const pago = await mp.payment.get({ id: dataId });
    if (pago?.status === 'approved') {
      const { isCart, items, productId, emailPart } = parseRef(pago.external_reference, pago.metadata?.items);
      await registrar({
        productId: isCart ? 'cart' : (pago.metadata?.product_id || pago.metadata?.productId || productId),
        items,
        email: pago.metadata?.email || pago.payer?.email || emailPart,
        monto: pago.transaction_amount || 0,
        provider: 'mercadopago',
        ref: String(pago.id),
      });
    }
  } catch (e) {
    console.error('[guias mp webhook]', e.message);
  }
  res.status(200).json({ received: true });
}

// ── Webhook de Stripe (opcional; requiere STRIPE_WEBHOOK_SECRET + body RAW) ──
export async function stripeWebhook(req, res, registrar) {
  const s = await getStripe();
  if (!s) return res.status(503).json({ error: 'Stripe no configurado' });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook no configurado' });
  let event = null;
  try {
    event = s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ error: `Firma inválida: ${e.message}` });
  }
  if (event.type === 'checkout.session.completed') {
    const ses = event.data.object;
    if (ses.payment_status === 'paid' || ses.status === 'complete') {
      await registrar({
        productId: ses.metadata?.productId,
        email: ses.metadata?.email || ses.customer_details?.email || ses.customer_email,
        monto: (ses.amount_total || 0) / 100,
        provider: 'stripe',
        ref: ses.id,
      });
    }
  }
  res.json({ received: true });
}
