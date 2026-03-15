/**
 * Script para diagnosticar y limpiar duplicados de Reyna
 *
 * USO:
 *   node scripts/fix-reyna-duplicates.js          → Solo diagnóstico (no borra nada)
 *   node scripts/fix-reyna-duplicates.js --fix     → Diagnóstico + eliminar duplicados
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const FIX_MODE = process.argv.includes('--fix');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Conectado a MongoDB\n');

  const db = mongoose.connection.db;

  // ==========================================
  // 1. Buscar proyectos de Reyna
  // ==========================================
  const projects = await db.collection('projects').find({
    $or: [
      { clientName: { $regex: /reyna/i } },
      { clientEmail: { $regex: /reyna/i } },
    ]
  }).sort({ createdAt: 1 }).toArray();

  console.log(`=== PROYECTOS CON "REYNA" (${projects.length}) ===`);
  projects.forEach((p, i) => {
    console.log(`  [${i + 1}] ID: ${p._id}`);
    console.log(`      Título: ${p.taskTitle}`);
    console.log(`      Cliente: ${p.clientName} | ${p.clientEmail}`);
    console.log(`      Status: ${p.status}`);
    console.log(`      Quote ref: ${p.quote || 'null'}`);
    console.log(`      Payment ref: ${p.payment || 'null'}`);
    console.log(`      Creado: ${p.createdAt}`);
    console.log('');
  });

  // ==========================================
  // 2. Buscar pagos de Reyna
  // ==========================================
  const payments = await db.collection('payments').find({
    $or: [
      { clientName: { $regex: /reyna/i } },
      { clientEmail: { $regex: /reyna/i } },
    ]
  }).sort({ createdAt: 1 }).toArray();

  console.log(`=== PAGOS CON "REYNA" (${payments.length}) ===`);
  payments.forEach((p, i) => {
    console.log(`  [${i + 1}] ID: ${p._id}`);
    console.log(`      Título: ${p.title}`);
    console.log(`      Cliente: ${p.clientName} | ${p.clientEmail}`);
    console.log(`      Monto: $${p.amount}`);
    console.log(`      Status: ${p.status}`);
    console.log(`      Project ref: ${p.project || 'null'}`);
    console.log(`      TransactionId: ${p.transactionId}`);
    console.log(`      Creado: ${p.createdAt}`);
    console.log('');
  });

  // ==========================================
  // 3. Buscar cotizaciones de Reyna
  // ==========================================
  const quotes = await db.collection('quotes').find({
    $or: [
      { name: { $regex: /reyna/i } },
      { email: { $regex: /reyna/i } },
    ]
  }).sort({ createdAt: 1 }).toArray();

  const genQuotes = await db.collection('generatedquotes').find({
    $or: [
      { clientName: { $regex: /reyna/i } },
      { clientEmail: { $regex: /reyna/i } },
    ]
  }).sort({ createdAt: 1 }).toArray();

  console.log(`=== COTIZACIONES REGULARES (${quotes.length}) ===`);
  quotes.forEach((q, i) => {
    console.log(`  [${i + 1}] ID: ${q._id} | ${q.taskTitle || q.taskType} | Status: ${q.status} | Creado: ${q.createdAt}`);
  });

  console.log(`\n=== COTIZACIONES GENERADAS (${genQuotes.length}) ===`);
  genQuotes.forEach((q, i) => {
    console.log(`  [${i + 1}] ID: ${q._id} | ${q.tipoTrabajo} | Status: ${q.status} | Precio: $${q.precioConDescuento || q.precioBase} | Creado: ${q.createdAt}`);
  });

  // ==========================================
  // 4. Detectar duplicados
  // ==========================================
  console.log('\n=== ANÁLISIS DE DUPLICADOS ===');

  // Agrupar proyectos por quote ref (o por clientEmail + taskTitle si quote es null)
  const projectGroups = {};
  projects.forEach(p => {
    const key = p.quote ? p.quote.toString() : `${p.clientEmail}-${p.taskTitle}`;
    if (!projectGroups[key]) projectGroups[key] = [];
    projectGroups[key].push(p);
  });

  const duplicateProjectGroups = Object.entries(projectGroups).filter(([, group]) => group.length > 1);

  if (duplicateProjectGroups.length === 0) {
    console.log('  No se encontraron proyectos duplicados por quote/email+titulo.');
  } else {
    console.log(`  ⚠️  ${duplicateProjectGroups.length} grupo(s) de proyectos duplicados:`);
    for (const [key, group] of duplicateProjectGroups) {
      console.log(`\n  Grupo "${key}" — ${group.length} proyectos:`);
      group.forEach((p, i) => {
        console.log(`    ${i === 0 ? '✅ MANTENER' : '❌ ELIMINAR'}: ${p._id} (creado: ${p.createdAt})`);
      });
    }
  }

  // Agrupar pagos por clientEmail + title (y opcionalmente monto)
  const paymentGroups = {};
  payments.forEach(p => {
    // Usar email o nombre si el email está vacío para la llave
    const clientKey = (p.clientEmail?.trim() || p.clientName?.trim() || 'unknown').toLowerCase();
    const titleKey = (p.title?.trim() || 'untitled').toLowerCase();
    const key = `${clientKey}-${titleKey}`;
    
    if (!paymentGroups[key]) paymentGroups[key] = [];
    paymentGroups[key].push(p);
  });

  const duplicatePaymentGroups = Object.entries(paymentGroups).filter(([, group]) => group.length > 1);

  if (duplicatePaymentGroups.length === 0) {
    console.log('\n  No se encontraron pagos duplicados.');
  } else {
    console.log(`\n  ⚠️  ${duplicatePaymentGroups.length} grupo(s) de pagos duplicados:`);
    for (const [key, group] of duplicatePaymentGroups) {
      console.log(`\n  Grupo "${key}" — ${group.length} pagos:`);
      group.forEach((p, i) => {
        const hasProject = p.project ? `(Proyecto: ${p.project})` : '(HUÉRFANO - Sin proyecto)';
        console.log(`    ${i === 0 ? '✅ MANTENER' : '❌ ELIMINAR'}: ${p._id} [$${p.amount}] ${hasProject} (creado: ${p.createdAt})`);
      });
    }
  }

  // ==========================================
  // 5. Limpiar duplicados si --fix
  // ==========================================
  if (FIX_MODE) {
    console.log('\n=== 🔧 MODO FIX: ELIMINANDO DUPLICADOS ===\n');

    let projectsDeleted = 0;
    let paymentsDeleted = 0;

    // Eliminar proyectos duplicados (mantener el primero, borrar los demás)
    for (const [key, group] of duplicateProjectGroups) {
      const toDelete = group.slice(1); // Mantener el primero
      for (const p of toDelete) {
        console.log(`  Eliminando proyecto duplicado: ${p._id} (${p.taskTitle})`);
        await db.collection('projects').deleteOne({ _id: p._id });
        projectsDeleted++;

        // También eliminar el pago vinculado a este proyecto duplicado
        if (p.payment) {
          console.log(`    → Eliminando pago vinculado: ${p.payment}`);
          await db.collection('payments').deleteOne({ _id: p.payment });
          paymentsDeleted++;
        }
      }
    }

    // Eliminar pagos duplicados restantes que no fueron capturados arriba
    for (const [key, group] of duplicatePaymentGroups) {
      const alreadyHandled = group.some(p =>
        duplicateProjectGroups.some(([, pg]) =>
          pg.slice(1).some(proj => proj.payment?.toString() === p._id.toString())
        )
      );
      if (alreadyHandled) continue;

      const toDelete = group.slice(1);
      for (const p of toDelete) {
        console.log(`  Eliminando pago duplicado: ${p._id} ($${p.amount})`);
        await db.collection('payments').deleteOne({ _id: p._id });
        paymentsDeleted++;
      }
    }

    console.log(`\n✅ Limpieza completada:`);
    console.log(`   Proyectos eliminados: ${projectsDeleted}`);
    console.log(`   Pagos eliminados: ${paymentsDeleted}`);
  } else {
    console.log('\n💡 Para eliminar los duplicados, ejecuta:');
    console.log('   node scripts/fix-reyna-duplicates.js --fix\n');
  }

  await mongoose.disconnect();
  console.log('Desconectado de MongoDB');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
