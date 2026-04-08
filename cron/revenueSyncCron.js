/**
 * Revenue Sync Cron Job
 * Se ejecuta diariamente a las 6:00 AM para sincronizar costos de APIs externas.
 * También se puede disparar manualmente desde el endpoint POST /revenue/sync.
 */
import cron from 'node-cron';
import Expense from '../models/Expense.js';
import { fetchAllProviderCosts } from '../services/costProviders.js';

export function startRevenueSyncCron() {
  // Ejecutar diariamente a las 6:00 AM (hora del servidor)
  cron.schedule('0 6 * * *', async () => {
    console.log('[RevenueCron] Ejecutando sync automático de costos...');

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    try {
      const { expenses: providerExpenses, errors } = await fetchAllProviderCosts(year, month);

      let created = 0;
      let updated = 0;
      let skipped = 0;

      const startOfMonth = new Date(year, month, 1);
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

      for (const expense of providerExpenses) {
        // ── Dedup mejorado: buscar por descripción prefix, luego por categoría ──
        const descPrefix = expense.description.split('—')[0].trim();

        let existing = await Expense.findOne({
          category: expense.category,
          source: { $in: ['api', 'calculated'] },
          date: { $gte: startOfMonth, $lte: endOfMonth },
          description: { $regex: descPrefix, $options: 'i' },
        });

        // Fallback: cualquier gasto automático de esa categoría en el mes
        if (!existing) {
          existing = await Expense.findOne({
            category: expense.category,
            source: { $in: ['api', 'calculated'] },
            isAutomatic: true,
            date: { $gte: startOfMonth, $lte: endOfMonth },
          });
        }

        if (existing) {
          if (Math.abs(existing.amount - expense.amount) > 0.01) {
            existing.amount = expense.amount;
            existing.metadata = expense.metadata;
            existing.description = expense.description;
            await existing.save();
            updated++;
          } else {
            skipped++;
          }
        } else {
          await Expense.create({
            ...expense,
            period: { month, year },
          });
          created++;
        }
      }

      console.log(`[RevenueCron] Sync completado: ${created} creados, ${updated} actualizados, ${skipped} sin cambios`);

      if (errors.length > 0) {
        console.warn('[RevenueCron] Errores en providers:', errors);
      }
    } catch (err) {
      console.error('[RevenueCron] Error fatal en sync:', err.message);
    }
  });

  console.log('[RevenueCron] Cron de sync de costos iniciado (diario a las 6:00 AM)');
}
