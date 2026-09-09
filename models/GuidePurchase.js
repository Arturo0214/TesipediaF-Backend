import mongoose from 'mongoose';

/**
 * Compra de una guía/producto digital (Taller APA 7, etc.).
 * El pago se confirma SIEMPRE contra la API del proveedor (webhook + verificación),
 * nunca desde datos que mande el cliente. La descarga se sirve solo con un token
 * ligado a una compra en estado 'paid'.
 */
const guidePurchaseSchema = new mongoose.Schema({
    productId: { type: String, required: true, index: true },
    // Para compras de carrito: lista de ids de productos incluidos (además de productId='cart').
    items: { type: [String], default: [] },
    productName: { type: String, default: '' },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'MXN' },
    provider: { type: String, enum: ['mercadopago', 'stripe'], required: true },
    // Referencia única del pago en el proveedor (payment id / session id) — evita duplicados.
    ref: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },
    // Token aleatorio para las descargas (revocable). Se genera al confirmarse el pago.
    downloadToken: { type: String, unique: true, sparse: true, index: true },
    downloadCount: { type: Number, default: 0 },
    emailedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
}, { timestamps: true });

const GuidePurchase = mongoose.model('GuidePurchase', guidePurchaseSchema);
export default GuidePurchase;
