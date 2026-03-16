/**
 * Script de corrección única: Nayeli
 * Su pago se creó con esquema 50-50 cuando debía ser 33-33-34.
 * Montos: $3,085.50 / $3,085.50 / $3,179.00 = $9,350.00 total
 * Fechas: 15 de marzo 2026 / 29 de marzo 2026 / 05 de abril 2026
 *
 * Uso: node scripts/fixNayeliPayment.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from '../models/Payment.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

const run = async () => {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definida en .env');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado a MongoDB');

  // Buscar el pago de Nayeli (buscar por nombre de cliente)
  const payments = await Payment.find({
    clientName: { $regex: /nayeli/i },
  }).sort({ createdAt: -1 });

  if (payments.length === 0) {
    console.log('⚠️ No se encontró ningún pago con clientName que contenga "Nayeli".');
    console.log('Buscando por monto $9,350...');
    const byAmount = await Payment.find({ amount: 9350 }).sort({ createdAt: -1 });
    if (byAmount.length > 0) {
      console.log(`Encontrado(s) ${byAmount.length} pago(s) por monto $9,350:`);
      byAmount.forEach(p => console.log(`  - ${p._id} | ${p.clientName} | ${p.esquemaPago} | ${p.createdAt}`));
    } else {
      console.log('❌ No se encontraron pagos. Verificar manualmente.');
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Encontrado(s) ${payments.length} pago(s) para Nayeli:`);
  payments.forEach(p => {
    console.log(`  - ID: ${p._id}`);
    console.log(`    Nombre: ${p.clientName}`);
    console.log(`    Monto: $${p.amount}`);
    console.log(`    Esquema actual: ${p.esquemaPago}`);
    console.log(`    Schedule actual: ${JSON.stringify(p.schedule, null, 2)}`);
    console.log('');
  });

  // Tomar el pago más reciente de Nayeli
  const payment = payments[0];

  if (payment.esquemaPago === '33-33-34') {
    console.log('✅ El pago ya tiene esquema 33-33-34. Verificando schedule...');
  }

  // Corregir esquema
  const newSchedule = [
    {
      number: 1,
      amount: 3086, // Math.round(3085.50)
      dueDate: new Date(2026, 2, 15), // 15 de marzo 2026
      label: '1er pago (33%)',
      status: 'paid',
    },
    {
      number: 2,
      amount: 3086, // Math.round(3085.50)
      dueDate: new Date(2026, 2, 29), // 29 de marzo 2026
      label: '2do pago (33%)',
      status: 'pending',
    },
    {
      number: 3,
      amount: 3179, // Math.round(3179.00)
      dueDate: new Date(2026, 3, 5), // 05 de abril 2026
      label: '3er pago (34%)',
      status: 'pending',
    },
  ];

  payment.esquemaPago = '33-33-34';
  payment.schedule = newSchedule;
  await payment.save();

  console.log('✅ Pago de Nayeli actualizado correctamente:');
  console.log(`   Esquema: ${payment.esquemaPago}`);
  console.log(`   Schedule:`);
  newSchedule.forEach(s => {
    console.log(`     ${s.label}: $${s.amount} — ${s.dueDate.toLocaleDateString('es-MX')} — ${s.status}`);
  });

  await mongoose.disconnect();
  console.log('✅ Desconectado de MongoDB');
};

run().catch(err => {
  console.error('❌ Error:', err);
  mongoose.disconnect();
  process.exit(1);
});
