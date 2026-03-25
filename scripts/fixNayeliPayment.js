/**
 * Script de corrección: Nayeli
 * 1. Corrige Payment: esquema 33-33-34, schedule con fechas correctas
 * 2. Corrige GeneratedQuote: paidAt = 15 de marzo 2026 (fecha real del primer pago)
 *    para que el dashboard no recalcule las fechas con updatedAt
 *
 * Montos: $3,085.50 / $3,085.50 / $3,179.00 = $9,350.00 total
 * Fechas: 15 de marzo 2026 / 29 de marzo 2026 / 05 de abril 2026
 *
 * Uso: node scripts/fixNayeliPayment.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from '../models/Payment.js';
import GeneratedQuote from '../models/GeneratedQuote.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const PAID_DATE = new Date(2026, 2, 15); // 15 de marzo 2026 — fecha real del primer pago

const newSchedule = [
  {
    number: 1,
    amount: 3086,
    dueDate: new Date(2026, 2, 15), // 15 de marzo 2026
    label: '1er pago (33%)',
    status: 'paid',
  },
  {
    number: 2,
    amount: 3086,
    dueDate: new Date(2026, 2, 29), // 29 de marzo 2026
    label: '2do pago (33%)',
    status: 'pending',
  },
  {
    number: 3,
    amount: 3179,
    dueDate: new Date(2026, 3, 5), // 05 de abril 2026
    label: '3er pago (34%)',
    status: 'pending',
  },
];

const run = async () => {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definida en .env');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado a MongoDB');

  // ── 1. Corregir Payment ──
  const payments = await Payment.find({
    clientName: { $regex: /nayeli/i },
  }).sort({ createdAt: -1 });

  if (payments.length > 0) {
    const payment = payments[0];
    console.log(`📋 Payment encontrado: ${payment._id} | ${payment.clientName} | $${payment.amount}`);

    payment.esquemaPago = '33-33-34';
    payment.schedule = newSchedule;
    payment.paymentDate = PAID_DATE;
    await payment.save();

    console.log('✅ Payment corregido:');
    newSchedule.forEach(s => {
      console.log(`   ${s.label}: $${s.amount} — ${s.dueDate.toLocaleDateString('es-MX')} — ${s.status}`);
    });
  } else {
    console.log('⚠️ No se encontró Payment para Nayeli');
  }

  // ── 2. Corregir GeneratedQuote (paidAt) ──
  const quotes = await GeneratedQuote.find({
    clientName: { $regex: /nayeli/i },
    status: 'paid',
  }).sort({ updatedAt: -1 });

  if (quotes.length > 0) {
    const quote = quotes[0];
    console.log(`📋 GeneratedQuote encontrada: ${quote._id} | ${quote.clientName} | paidAt: ${quote.paidAt || 'NULL'}`);

    // Usar updateOne con timestamps:false para NO cambiar updatedAt
    await GeneratedQuote.updateOne(
      { _id: quote._id },
      { $set: { paidAt: PAID_DATE } },
      { timestamps: false }
    );

    console.log(`✅ GeneratedQuote.paidAt corregido a: ${PAID_DATE.toLocaleDateString('es-MX')}`);
  } else {
    console.log('⚠️ No se encontró GeneratedQuote pagada para Nayeli');
  }

  await mongoose.disconnect();
  console.log('✅ Desconectado de MongoDB');
};

run().catch(err => {
  console.error('❌ Error:', err);
  mongoose.disconnect();
  process.exit(1);
});
