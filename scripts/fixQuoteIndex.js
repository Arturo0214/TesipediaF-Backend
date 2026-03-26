/**
 * Script de migración: Corregir índice quote_1 y crear proyectos faltantes
 *
 * Problema: El índice unique quote_1 en la colección projects impide crear
 * múltiples proyectos con quote: null (cotizaciones generadas).
 *
 * Solución:
 * 1. Eliminar el índice quote_1 problemático
 * 2. Crear proyectos para cotizaciones pagadas que no tienen proyecto vinculado
 *
 * Uso: node scripts/fixQuoteIndex.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import Project from '../models/Project.js';
import Payment from '../models/Payment.js';
import GeneratedQuote from '../models/GeneratedQuote.js';
import Quote from '../models/Quote.js';
import { autoCreateClientUser } from '../utils/autoCreateClient.js';

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  console.log('🔧 Conectando a MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado a MongoDB');

  // ============================================================
  // PASO 1: Eliminar el índice quote_1 problemático
  // ============================================================
  console.log('\n📋 Paso 1: Verificando índices de la colección projects...');
  const collection = mongoose.connection.db.collection('projects');
  const indexes = await collection.indexes();

  console.log('Índices actuales:');
  indexes.forEach(idx => {
    console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} ${idx.unique ? '(UNIQUE)' : ''} ${idx.sparse ? '(SPARSE)' : ''}`);
  });

  const quoteIndex = indexes.find(idx => idx.name === 'quote_1');
  if (quoteIndex) {
    console.log(`\n⚠️  Encontrado índice problemático: quote_1 (unique: ${!!quoteIndex.unique})`);
    console.log('   Eliminando índice...');
    await collection.dropIndex('quote_1');
    console.log('   ✅ Índice quote_1 eliminado exitosamente');
  } else {
    console.log('\n✅ No se encontró el índice quote_1 (ya fue eliminado o no existe)');
  }

  // ============================================================
  // PASO 2: Crear proyectos faltantes para cotizaciones pagadas
  // ============================================================
  console.log('\n📋 Paso 2: Buscando cotizaciones generadas pagadas sin proyecto vinculado...');

  const paidGenerated = await GeneratedQuote.find({ status: 'paid' });
  console.log(`   Cotizaciones generadas pagadas: ${paidGenerated.length}`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const quote of paidGenerated) {
    // Verificar si ya existe un proyecto para esta cotización
    const existingProject = await Project.findOne({ generatedQuote: quote._id });
    if (existingProject) {
      console.log(`   ⏭️  ${quote.clientName} - "${quote.tituloTrabajo || quote.tipoTrabajo}" ya tiene proyecto (${existingProject._id})`);
      skipped++;
      continue;
    }

    // También verificar por combinación de datos (por si se creó antes de agregar generatedQuote)
    const existingByData = await Project.findOne({
      clientName: quote.clientName,
      taskTitle: quote.tituloTrabajo || quote.tipoTrabajo || 'Proyecto Tesipedia',
    });
    if (existingByData) {
      // Vincular la cotización generada al proyecto existente
      existingByData.generatedQuote = quote._id;
      await existingByData.save();
      console.log(`   🔗 ${quote.clientName} - Vinculado proyecto existente (${existingByData._id})`);
      skipped++;
      continue;
    }

    try {
      // Parsear fecha de entrega
      let parsedDueDate = null;
      if (quote.fechaEntrega) {
        const meses = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
        const match = quote.fechaEntrega.match(/(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?/i);
        if (match) {
          const day = parseInt(match[1]);
          const month = meses[match[2].toLowerCase()];
          const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
          if (month !== undefined) parsedDueDate = new Date(year, month, day);
        }
        if (!parsedDueDate) {
          const d = new Date(quote.fechaEntrega);
          if (!isNaN(d.getTime())) parsedDueDate = d;
        }
      }

      // Auto-crear usuario cliente si hay email o teléfono
      let clientUser = null;
      if (quote.clientEmail || quote.clientPhone) {
        const result = await autoCreateClientUser({
          clientName: quote.clientName || 'Cliente',
          clientEmail: quote.clientEmail || '',
          clientPhone: quote.clientPhone || '',
          projectTitle: quote.tituloTrabajo || quote.tipoTrabajo,
        });
        clientUser = result.user;
      }

      // Buscar pago existente vinculado a esta cotización (por transactionId o datos similares)
      let existingPayment = await Payment.findOne({
        clientName: quote.clientName,
        title: quote.tituloTrabajo || quote.tipoTrabajo,
        isManual: true,
      });

      // Crear proyecto
      const project = await Project.create({
        quote: null,
        generatedQuote: quote._id,
        taskType: quote.tipoTrabajo?.trim() || 'Trabajo Académico',
        studyArea: quote.area?.trim() || 'General',
        career: quote.carrera?.trim() || 'General',
        educationLevel: 'licenciatura',
        taskTitle: (quote.tituloTrabajo?.trim() || quote.tipoTrabajo?.trim() || 'Proyecto Tesipedia'),
        requirements: { text: quote.descripcionServicio?.trim() || 'Proyecto creado por migración' },
        pages: parseInt(quote.extensionEstimada) || 1,
        dueDate: parsedDueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        priority: 'medium',
        status: 'pending',
        clientName: quote.clientName || '',
        clientEmail: quote.clientEmail || '',
        clientPhone: quote.clientPhone || '',
        client: clientUser?._id || null,
        payment: existingPayment?._id || null,
      });

      // Vincular pago al proyecto si existe
      if (existingPayment && !existingPayment.project) {
        existingPayment.project = project._id;
        await existingPayment.save();
      }

      console.log(`   ✅ Proyecto creado: ${quote.clientName} - "${project.taskTitle}" (${project._id})`);
      created++;
    } catch (err) {
      console.error(`   ❌ Error creando proyecto para ${quote.clientName}: ${err.message}`);
      errors++;
    }
  }

  // También verificar cotizaciones regulares pagadas
  console.log('\n📋 Verificando cotizaciones regulares pagadas sin proyecto...');
  const paidRegular = await Quote.find({ status: 'paid' });
  console.log(`   Cotizaciones regulares pagadas: ${paidRegular.length}`);

  for (const quote of paidRegular) {
    const existingProject = await Project.findOne({ quote: quote._id });
    if (existingProject) {
      console.log(`   ⏭️  ${quote.name} - "${quote.taskTitle}" ya tiene proyecto`);
      skipped++;
      continue;
    }

    try {
      let clientUser = null;
      if (quote.email || quote.phone) {
        const result = await autoCreateClientUser({
          clientName: quote.name || 'Cliente',
          clientEmail: quote.email || '',
          clientPhone: quote.phone || '',
          projectTitle: quote.taskTitle,
        });
        clientUser = result.user;
      }

      const project = await Project.create({
        quote: quote._id,
        generatedQuote: null,
        taskType: quote.taskType,
        studyArea: quote.studyArea,
        career: quote.career,
        educationLevel: quote.educationLevel,
        taskTitle: quote.taskTitle,
        requirements: quote.requirements || { text: 'Proyecto creado por migración' },
        pages: quote.pages,
        dueDate: quote.dueDate,
        priority: 'medium',
        status: 'pending',
        client: clientUser?._id || quote.user || null,
        clientName: quote.name || '',
        clientEmail: quote.email || '',
        clientPhone: quote.phone || '',
      });

      console.log(`   ✅ Proyecto creado: ${quote.name} - "${project.taskTitle}" (${project._id})`);
      created++;
    } catch (err) {
      console.error(`   ❌ Error creando proyecto para ${quote.name}: ${err.message}`);
      errors++;
    }
  }

  // ============================================================
  // RESUMEN
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE MIGRACIÓN');
  console.log('='.repeat(60));
  console.log(`   Proyectos creados: ${created}`);
  console.log(`   Omitidos (ya existían): ${skipped}`);
  console.log(`   Errores: ${errors}`);

  // Verificar índices finales
  const finalIndexes = await collection.indexes();
  console.log('\n📋 Índices finales:');
  finalIndexes.forEach(idx => {
    console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)} ${idx.unique ? '(UNIQUE)' : ''}`);
  });

  console.log('\n✅ Migración completada');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
