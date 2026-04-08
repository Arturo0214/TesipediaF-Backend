import express from 'express';
import asyncHandler from 'express-async-handler';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import Expense from '../models/Expense.js';
import Payment from '../models/Payment.js';
import { fetchAllProviderCosts, allProviders, fetchAllCampaigns } from '../services/costProviders.js';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

const router = express.Router();

// ═══════════════════════════════════════════════════
// GET /revenue/dashboard — Dashboard principal de revenue
// ═══════════════════════════════════════════════════
router.get('/dashboard', protect, adminOnly, asyncHandler(async (req, res) => {
  const { year, month } = req.query;
  const now = new Date();
  const targetYear = parseInt(year) || now.getFullYear();
  const targetMonth = month !== undefined ? parseInt(month) : now.getMonth();

  // Rango del mes actual
  const startOfMonth = new Date(targetYear, targetMonth, 1);
  const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  // Rango del año
  const startOfYear = new Date(targetYear, 0, 1);
  const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59);

  // ── INGRESOS: pagos completados ──
  // Usar paymentDate (cuando existe) en vez de createdAt para que pagos
  // manuales o marcados como pagados aparezcan en el mes correcto.
  const dateField = { $ifNull: ['$paymentDate', '$createdAt'] };

  const [monthlyIncome, yearlyIncome] = await Promise.all([
    Payment.aggregate([
      { $match: { status: 'completed' } },
      { $addFields: { _effectiveDate: dateField } },
      { $match: { _effectiveDate: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Payment.aggregate([
      { $match: { status: 'completed' } },
      { $addFields: { _effectiveDate: dateField } },
      { $match: { _effectiveDate: { $gte: startOfYear, $lte: endOfYear } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
  ]);

  // Ingresos por mes (para gráfica anual)
  const incomeByMonth = await Payment.aggregate([
    { $match: { status: 'completed' } },
    { $addFields: { _effectiveDate: dateField } },
    { $match: { _effectiveDate: { $gte: startOfYear, $lte: endOfYear } } },
    {
      $group: {
        _id: { $month: '$_effectiveDate' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      }
    },
    { $sort: { _id: 1 } }
  ]);

  // ── GASTOS: del modelo Expense ──
  const [monthlyExpenses, yearlyExpenses] = await Promise.all([
    Expense.aggregate([
      { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: startOfYear, $lte: endOfYear } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]),
  ]);

  // Gastos por mes (para gráfica anual)
  const expensesByMonth = await Expense.aggregate([
    { $match: { date: { $gte: startOfYear, $lte: endOfYear } } },
    {
      $group: {
        _id: { month: { $month: '$date' }, category: '$category' },
        total: { $sum: '$amount' },
      }
    },
    { $sort: { '_id.month': 1 } }
  ]);

  // ── COSTO POR TESIS: cálculo promedio ──
  const completedPaymentsThisMonth = monthlyIncome[0]?.count || 0;
  const totalMonthlyExpenses = monthlyExpenses.reduce((acc, e) => acc + e.total, 0);
  const costPerThesis = completedPaymentsThisMonth > 0
    ? (totalMonthlyExpenses / completedPaymentsThisMonth)
    : 0;

  // ── Ingresos por vendedor este mes ──
  const incomeByVendedor = await Payment.aggregate([
    { $match: { status: 'completed', vendedor: { $ne: '' } } },
    { $addFields: { _effectiveDate: dateField } },
    { $match: { _effectiveDate: { $gte: startOfMonth, $lte: endOfMonth } } },
    { $group: { _id: '$vendedor', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } }
  ]);

  // ── Pagos individuales del mes (para contraste ingreso vs gasto) ──
  const recentPayments = await Payment.aggregate([
    { $match: { status: 'completed' } },
    { $addFields: { _effectiveDate: dateField } },
    { $match: { _effectiveDate: { $gte: startOfMonth, $lte: endOfMonth } } },
    { $project: { clientName: 1, title: 1, amount: 1, method: 1, vendedor: 1, createdAt: 1, paymentDate: 1, currency: 1, status: 1 } },
    { $sort: { _effectiveDate: -1 } },
    { $limit: 50 }
  ]);

  const monthlyIncomeTotal = monthlyIncome[0]?.total || 0;
  const yearlyIncomeTotal = yearlyIncome[0]?.total || 0;

  res.json({
    period: { year: targetYear, month: targetMonth },
    income: {
      monthly: { total: monthlyIncomeTotal, count: monthlyIncome[0]?.count || 0 },
      yearly: { total: yearlyIncomeTotal, count: yearlyIncome[0]?.count || 0 },
      byMonth: incomeByMonth,
      byVendedor: incomeByVendedor,
    },
    expenses: {
      monthly: {
        total: totalMonthlyExpenses,
        byCategory: monthlyExpenses,
      },
      yearly: {
        total: yearlyExpenses.reduce((acc, e) => acc + e.total, 0),
        byCategory: yearlyExpenses,
      },
      byMonth: expensesByMonth,
    },
    profit: {
      monthly: monthlyIncomeTotal - totalMonthlyExpenses,
      yearly: yearlyIncomeTotal - yearlyExpenses.reduce((acc, e) => acc + e.total, 0),
    },
    costPerThesis: Math.round(costPerThesis * 100) / 100,
    salesCount: completedPaymentsThisMonth,
    recentPayments,
  });
}));

// ═══════════════════════════════════════════════════
// GET /revenue/expenses — Listar gastos con filtros
// ═══════════════════════════════════════════════════
router.get('/expenses', protect, adminOnly, asyncHandler(async (req, res) => {
  const { category, startDate, endDate, page = 1, limit = 50 } = req.query;
  const filter = {};

  if (category) filter.category = category;
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('relatedPayment', 'clientName title amount')
      .populate('relatedProject', 'clientName status')
      .populate('createdBy', 'name email'),
    Expense.countDocuments(filter),
  ]);

  res.json({
    expenses,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
}));

// ═══════════════════════════════════════════════════
// POST /revenue/expenses — Crear un gasto
// ═══════════════════════════════════════════════════
router.post('/expenses', protect, adminOnly, asyncHandler(async (req, res) => {
  const {
    category, description, amount, currency, date,
    relatedPayment, relatedProject, isRecurring,
    recurringInterval, period, metadata, source,
  } = req.body;

  if (!category || amount === undefined) {
    res.status(400);
    throw new Error('Categoría y monto son requeridos');
  }

  const expenseDate = date ? new Date(date) : new Date();

  const expense = await Expense.create({
    category,
    description: description || '',
    amount,
    currency: currency || 'MXN',
    date: expenseDate,
    relatedPayment: relatedPayment || null,
    relatedProject: relatedProject || null,
    isRecurring: isRecurring || false,
    recurringInterval: recurringInterval || null,
    period: period || {
      month: expenseDate.getMonth(),
      year: expenseDate.getFullYear(),
    },
    createdBy: req.user._id,
    source: source || 'manual',
    metadata: metadata || {},
  });

  res.status(201).json(expense);
}));

// ═══════════════════════════════════════════════════
// POST /revenue/expenses/bulk — Crear gastos en bulk
// ═══════════════════════════════════════════════════
router.post('/expenses/bulk', protect, adminOnly, asyncHandler(async (req, res) => {
  const { expenses } = req.body;

  if (!Array.isArray(expenses) || expenses.length === 0) {
    res.status(400);
    throw new Error('Se requiere un array de gastos');
  }

  const created = await Expense.insertMany(
    expenses.map(exp => ({
      ...exp,
      createdBy: req.user._id,
      date: exp.date ? new Date(exp.date) : new Date(),
      period: exp.period || {
        month: (exp.date ? new Date(exp.date) : new Date()).getMonth(),
        year: (exp.date ? new Date(exp.date) : new Date()).getFullYear(),
      },
    }))
  );

  res.status(201).json({ count: created.length, expenses: created });
}));

// ═══════════════════════════════════════════════════
// PUT /revenue/expenses/:id — Actualizar un gasto
// ═══════════════════════════════════════════════════
router.put('/expenses/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);

  if (!expense) {
    res.status(404);
    throw new Error('Gasto no encontrado');
  }

  const updatedFields = ['category', 'description', 'amount', 'currency', 'date',
    'relatedPayment', 'relatedProject', 'isRecurring', 'recurringInterval',
    'period', 'metadata'];

  updatedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      expense[field] = req.body[field];
    }
  });

  const updated = await expense.save();
  res.json(updated);
}));

// ═══════════════════════════════════════════════════
// DELETE /revenue/expenses/:id — Eliminar un gasto
// ═══════════════════════════════════════════════════
router.delete('/expenses/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);

  if (!expense) {
    res.status(404);
    throw new Error('Gasto no encontrado');
  }

  await expense.deleteOne();
  res.json({ message: 'Gasto eliminado correctamente' });
}));

// ═══════════════════════════════════════════════════
// POST /revenue/auto-costs/:paymentId — Auto-calcular costos operativos de una venta
// Crea automáticamente: comisión vendedor (20%), Turnitin ($150), anti-IA ($100)
// ═══════════════════════════════════════════════════
router.post('/auto-costs/:paymentId', protect, adminOnly, asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.paymentId);

  if (!payment) {
    res.status(404);
    throw new Error('Pago no encontrado');
  }

  const expenseDate = payment.createdAt || new Date();
  const period = {
    month: expenseDate.getMonth(),
    year: expenseDate.getFullYear(),
  };

  const costsToCreate = [];

  // Comisión del vendedor (20% del monto)
  if (payment.vendedor) {
    costsToCreate.push({
      category: 'comision_vendedor',
      description: `Comisión 20% — Vendedor: ${payment.vendedor} — ${payment.clientName || payment.title || 'Venta'}`,
      amount: Math.round(payment.amount * 0.20 * 100) / 100,
      date: expenseDate,
      period,
      relatedPayment: payment._id,
      relatedProject: payment.project || null,
      source: 'calculated',
      createdBy: req.user._id,
      metadata: { vendedor: payment.vendedor, paymentAmount: payment.amount },
    });
  }

  // Escáner Turnitin ($150 MXN)
  costsToCreate.push({
    category: 'turnitin',
    description: `Escáner Turnitin — ${payment.clientName || payment.title || 'Venta'}`,
    amount: 150,
    date: expenseDate,
    period,
    relatedPayment: payment._id,
    relatedProject: payment.project || null,
    source: 'calculated',
    createdBy: req.user._id,
  });

  // Escáner anti-IA ($100 MXN)
  costsToCreate.push({
    category: 'antiplagio_ia',
    description: `Escáner Anti-IA — ${payment.clientName || payment.title || 'Venta'}`,
    amount: 100,
    date: expenseDate,
    period,
    relatedPayment: payment._id,
    relatedProject: payment.project || null,
    source: 'calculated',
    createdBy: req.user._id,
  });

  const created = await Expense.insertMany(costsToCreate);

  res.status(201).json({
    message: `Se crearon ${created.length} costos operativos`,
    expenses: created,
    totalCost: created.reduce((acc, e) => acc + e.amount, 0),
  });
}));

// ═══════════════════════════════════════════════════
// GET /revenue/cost-per-sale — Costo detallado por venta
// ═══════════════════════════════════════════════════
router.get('/cost-per-sale', protect, adminOnly, asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const now = new Date();
  const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = endDate ? new Date(endDate) : now;

  // Pagos completados en el período
  const payments = await Payment.find({
    status: 'completed',
    createdAt: { $gte: start, $lte: end },
  }).lean();

  // Para cada pago, buscar sus gastos asociados
  const salesWithCosts = await Promise.all(
    payments.map(async (payment) => {
      const expenses = await Expense.find({ relatedPayment: payment._id }).lean();
      const totalCost = expenses.reduce((acc, e) => acc + e.amount, 0);
      return {
        payment: {
          _id: payment._id,
          clientName: payment.clientName,
          title: payment.title,
          amount: payment.amount,
          vendedor: payment.vendedor,
          date: payment.createdAt,
          method: payment.method,
        },
        expenses,
        totalCost,
        profit: payment.amount - totalCost,
        margin: payment.amount > 0 ? ((payment.amount - totalCost) / payment.amount * 100).toFixed(1) : 0,
      };
    })
  );

  // Resumen
  const totalRevenue = salesWithCosts.reduce((acc, s) => acc + s.payment.amount, 0);
  const totalCosts = salesWithCosts.reduce((acc, s) => acc + s.totalCost, 0);

  res.json({
    sales: salesWithCosts,
    summary: {
      totalSales: salesWithCosts.length,
      totalRevenue,
      totalCosts,
      totalProfit: totalRevenue - totalCosts,
      avgCostPerSale: salesWithCosts.length > 0 ? Math.round(totalCosts / salesWithCosts.length) : 0,
      avgMargin: salesWithCosts.length > 0
        ? (salesWithCosts.reduce((acc, s) => acc + parseFloat(s.margin), 0) / salesWithCosts.length).toFixed(1)
        : 0,
    },
  });
}));

// ═══════════════════════════════════════════════════
// GET /revenue/categories — Lista de categorías con etiquetas
// ═══════════════════════════════════════════════════
router.get('/categories', protect, adminOnly, asyncHandler(async (req, res) => {
  res.json([
    { value: 'claude_api', label: 'Claude AI (API)', icon: 'brain', color: '#8B5CF6' },
    { value: 'meta_ads', label: 'Meta Ads', icon: 'facebook', color: '#1877F2' },
    { value: 'google_ads', label: 'Google Ads', icon: 'google', color: '#EA4335' },
    { value: 'netlify', label: 'Netlify', icon: 'cloud', color: '#00C7B7' },
    { value: 'railway', label: 'Railway', icon: 'server', color: '#0B0D0E' },
    { value: 'comision_vendedor', label: 'Comisión Vendedor (20%)', icon: 'user-tie', color: '#F59E0B' },
    { value: 'turnitin', label: 'Turnitin ($150)', icon: 'search', color: '#2563EB' },
    { value: 'antiplagio_ia', label: 'Anti-IA ($100)', icon: 'robot', color: '#DC2626' },
    { value: 'dominio', label: 'Dominio', icon: 'globe', color: '#059669' },
    { value: 'cloudinary', label: 'Cloudinary', icon: 'image', color: '#3448C5' },
    { value: 'stripe_fees', label: 'Comisiones Stripe', icon: 'credit-card', color: '#635BFF' },
    { value: 'paypal_fees', label: 'Comisiones PayPal', icon: 'paypal', color: '#003087' },
    { value: 'otro', label: 'Otro', icon: 'ellipsis-h', color: '#6B7280' },
  ]);
}));

// ═══════════════════════════════════════════════════
// POST /revenue/sync — Sincronizar costos desde todas las APIs externas
// Jala datos de Anthropic, Meta, Google, Netlify, Railway
// y los guarda como expenses evitando duplicados
// ═══════════════════════════════════════════════════
router.post('/sync', protect, adminOnly, asyncHandler(async (req, res) => {
  const { year, month } = req.body;
  const now = new Date();
  const targetYear = parseInt(year) || now.getFullYear();
  const targetMonth = month !== undefined ? parseInt(month) : now.getMonth();

  console.log(`[Revenue Sync] Iniciando sync para ${targetYear}-${targetMonth + 1}...`);

  // Fetch costs from all providers
  const { expenses: providerExpenses, errors, providerResults } = await fetchAllProviderCosts(targetYear, targetMonth);

  const created = [];
  const skipped = [];

  const startOfMonth = new Date(targetYear, targetMonth, 1);
  const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  for (const expense of providerExpenses) {
    // ── Dedup mejorado: buscar por categoría + mes + source automático ──
    // Primero intentar match exacto por descripción prefix, luego por categoría sola
    const descPrefix = expense.description.split('—')[0].trim();

    let existing = await Expense.findOne({
      category: expense.category,
      source: { $in: ['api', 'calculated'] },
      date: { $gte: startOfMonth, $lte: endOfMonth },
      description: { $regex: descPrefix, $options: 'i' },
    });

    // Si no se encontró por descripción, buscar CUALQUIER gasto automático de esa categoría en el mes
    // Esto previene duplicados cuando cambia el formato de la descripción
    if (!existing) {
      existing = await Expense.findOne({
        category: expense.category,
        source: { $in: ['api', 'calculated'] },
        isAutomatic: true,
        date: { $gte: startOfMonth, $lte: endOfMonth },
      });
    }

    if (existing) {
      // Actualizar si el monto cambió
      if (Math.abs(existing.amount - expense.amount) > 0.01) {
        existing.amount = expense.amount;
        existing.metadata = expense.metadata;
        existing.description = expense.description;
        await existing.save();
        created.push({ ...expense, action: 'updated' });
      } else {
        skipped.push({ category: expense.category, description: expense.description, reason: 'already exists' });
      }
    } else {
      // Crear nuevo
      const newExpense = await Expense.create({
        ...expense,
        period: { month: targetMonth, year: targetYear },
        createdBy: req.user._id,
      });
      created.push({ ...newExpense.toObject(), action: 'created' });
    }
  }

  console.log(`[Revenue Sync] Completado: ${created.length} creados/actualizados, ${skipped.length} omitidos, ${errors.length} errores`);

  res.json({
    message: `Sync completado para ${new Date(targetYear, targetMonth).toLocaleString('es-MX', { month: 'long', year: 'numeric' })}`,
    created: created.length,
    skipped: skipped.length,
    errors,
    details: { created, skipped },
    providerResults: Object.keys(providerResults).map(name => ({
      provider: name,
      hasData: (providerResults[name].expenses?.length || 0) > 0,
      error: providerResults[name].error || null,
    })),
  });
}));

// ═══════════════════════════════════════════════════
// POST /revenue/cleanup-duplicates — Eliminar gastos automáticos duplicados
// Mantiene solo el más reciente por categoría+mes, elimina los demás
// ═══════════════════════════════════════════════════
router.post('/cleanup-duplicates', protect, adminOnly, asyncHandler(async (req, res) => {
  const { year, month } = req.body;
  const now = new Date();
  const targetYear = parseInt(year) || now.getFullYear();
  const targetMonth = month !== undefined ? parseInt(month) : now.getMonth();

  const startOfMonth = new Date(targetYear, targetMonth, 1);
  const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  console.log(`[Revenue Cleanup] Buscando duplicados para ${targetYear}-${targetMonth + 1}...`);

  // Buscar todos los gastos automáticos del mes agrupados por categoría
  const autoExpenses = await Expense.find({
    source: { $in: ['api', 'calculated'] },
    date: { $gte: startOfMonth, $lte: endOfMonth },
  }).sort({ updatedAt: -1, createdAt: -1 });

  const categoryMap = {};
  const toDelete = [];

  for (const exp of autoExpenses) {
    const key = exp.category;
    if (!categoryMap[key]) {
      categoryMap[key] = exp; // Mantener el primero (más reciente por sort)
    } else {
      toDelete.push(exp); // Duplicado → marcar para eliminar
    }
  }

  // Eliminar duplicados
  let deleted = 0;
  for (const dup of toDelete) {
    await dup.deleteOne();
    deleted++;
    console.log(`[Revenue Cleanup] Eliminado duplicado: ${dup.category} — ${dup.description} ($${dup.amount})`);
  }

  // Además, actualizar los montos de las suscripciones fijas según .env actual
  const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;
  const fixes = [];

  // Fix Anthropic subscription
  const anthropicCost = parseFloat(process.env.ANTHROPIC_SUBSCRIPTION_COST) || 200;
  const anthropicExpected = Math.round(anthropicCost * usdToMxn * 100) / 100;
  const anthropicExp = categoryMap['claude_api'];
  if (anthropicExp && Math.abs(anthropicExp.amount - anthropicExpected) > 0.01) {
    const oldAmount = anthropicExp.amount;
    anthropicExp.amount = anthropicExpected;
    anthropicExp.metadata = {
      ...anthropicExp.metadata,
      originalAmount: anthropicCost,
      exchangeRate: usdToMxn,
    };
    await anthropicExp.save();
    fixes.push({ category: 'claude_api', oldAmount, newAmount: anthropicExpected });
  }

  // Fix Railway
  const railwayCost = parseFloat(process.env.RAILWAY_MONTHLY_COST) || 20;
  const railwayExpected = Math.round(railwayCost * usdToMxn * 100) / 100;
  const railwayExp = categoryMap['railway'];
  if (railwayExp && Math.abs(railwayExp.amount - railwayExpected) > 0.01 && railwayExp.source === 'calculated') {
    const oldAmount = railwayExp.amount;
    railwayExp.amount = railwayExpected;
    railwayExp.metadata = { ...railwayExp.metadata, originalAmount: railwayCost, exchangeRate: usdToMxn };
    await railwayExp.save();
    fixes.push({ category: 'railway', oldAmount, newAmount: railwayExpected });
  }

  // Fix Netlify
  const netlifyCost = parseFloat(process.env.NETLIFY_MONTHLY_COST) || 9;
  const netlifyExpected = Math.round(netlifyCost * usdToMxn * 100) / 100;
  const netlifyExp = categoryMap['netlify'];
  if (netlifyExp && Math.abs(netlifyExp.amount - netlifyExpected) > 0.01 && netlifyExp.source !== 'api') {
    const oldAmount = netlifyExp.amount;
    netlifyExp.amount = netlifyExpected;
    netlifyExp.metadata = { ...netlifyExp.metadata, originalAmount: netlifyCost, exchangeRate: usdToMxn };
    await netlifyExp.save();
    fixes.push({ category: 'netlify', oldAmount, newAmount: netlifyExpected });
  }

  console.log(`[Revenue Cleanup] Completado: ${deleted} duplicados eliminados, ${fixes.length} montos corregidos`);

  res.json({
    message: `Limpieza completada para ${new Date(targetYear, targetMonth).toLocaleString('es-MX', { month: 'long', year: 'numeric' })}`,
    duplicatesDeleted: deleted,
    deletedExpenses: toDelete.map(d => ({ category: d.category, description: d.description, amount: d.amount })),
    amountFixes: fixes,
    remaining: Object.values(categoryMap).map(e => ({ category: e.category, description: e.description, amount: e.amount })),
  });
}));

// ═══════════════════════════════════════════════════
// GET /revenue/sync-status — Estado de configuración de cada provider
// ═══════════════════════════════════════════════════
router.get('/sync-status', protect, adminOnly, asyncHandler(async (req, res) => {
  const providers = [
    {
      name: 'Anthropic API',
      category: 'claude_api',
      configured: !!(process.env.ANTHROPIC_ADMIN_API_KEY || process.env.ANTHROPIC_MONTHLY_COST),
      envVars: ['ANTHROPIC_ADMIN_API_KEY', 'ANTHROPIC_MONTHLY_COST'],
    },
    {
      name: 'Suscripción Anthropic ($200 USD)',
      category: 'claude_api',
      configured: true, // Siempre activo como gasto fijo
      envVars: ['ANTHROPIC_SUBSCRIPTION_COST'],
    },
    {
      name: 'Meta Ads',
      category: 'meta_ads',
      configured: !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),
      envVars: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'],
    },
    {
      name: 'Google Ads',
      category: 'google_ads',
      configured: !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID),
      envVars: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
    },
    {
      name: 'Netlify',
      category: 'netlify',
      configured: true, // Funciona con o sin token (fallback a costo fijo)
      envVars: ['NETLIFY_ACCESS_TOKEN', 'NETLIFY_MONTHLY_COST'],
    },
    {
      name: 'Railway',
      category: 'railway',
      configured: true, // Funciona con o sin token (fallback a costo fijo)
      envVars: ['RAILWAY_API_TOKEN', 'RAILWAY_MONTHLY_COST'],
    },
  ];

  // Tipo de cambio actual
  const exchangeRate = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;

  res.json({ providers, exchangeRate });
}));

// ═══════════════════════════════════════════════════
// GET /revenue/campaigns — Campañas de Meta Ads y Google Ads en tiempo real
// ═══════════════════════════════════════════════════
router.get('/campaigns', protect, adminOnly, asyncHandler(async (req, res) => {
  const { year, month } = req.query;
  const now = new Date();
  const targetYear = parseInt(year) || now.getFullYear();
  const targetMonth = month !== undefined ? parseInt(month) : now.getMonth();

  console.log(`[Revenue Campaigns] Fetching campaigns for ${targetYear}-${targetMonth + 1}...`);

  const result = await fetchAllCampaigns(targetYear, targetMonth);

  res.json({
    period: { year: targetYear, month: targetMonth },
    ...result,
  });
}));

// ═══════════════════════════════════════════════════
// GET /revenue/usage — Uso en tiempo real de Anthropic, Railway, Netlify
// ═══════════════════════════════════════════════════
router.get('/usage', protect, adminOnly, asyncHandler(async (req, res) => {
  const results = {};
  const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;

  // ── Anthropic: subscription + API usage ──
  const anthropicAdminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  const subscriptionCost = parseFloat(process.env.ANTHROPIC_SUBSCRIPTION_COST) || 200;
  if (anthropicAdminKey) {
    try {
      const billingRes = await axios.get('https://api.anthropic.com/v1/organizations/billing', {
        headers: { 'x-api-key': anthropicAdminKey, 'anthropic-version': '2023-06-01' },
      });
      results.anthropic = {
        status: 'ok',
        data: {
          ...billingRes.data,
          subscriptionCostUSD: subscriptionCost,
          subscriptionCostMXN: Math.round(subscriptionCost * usdToMxn * 100) / 100,
        },
      };
    } catch (err) {
      results.anthropic = {
        status: 'subscription_only',
        data: {
          subscriptionCostUSD: subscriptionCost,
          subscriptionCostMXN: Math.round(subscriptionCost * usdToMxn * 100) / 100,
          note: 'Suscripción fija mensual (API billing no disponible)',
        },
      };
    }
  } else {
    results.anthropic = {
      status: 'subscription_only',
      data: {
        subscriptionCostUSD: subscriptionCost,
        subscriptionCostMXN: Math.round(subscriptionCost * usdToMxn * 100) / 100,
        note: 'Suscripción fija mensual',
      },
    };
  }

  // ── Railway: usage via GraphQL ──
  const railwayToken = process.env.RAILWAY_API_TOKEN;
  if (railwayToken) {
    try {
      const query = `
        query {
          me {
            workspaces {
              edges {
                node {
                  id
                  name
                  usage {
                    currentUsage
                    estimatedUsage
                    planLimitUsage
                    planUsageLimit
                    currentBillEstimate
                    billingCycleStart
                    billingCycleEnd
                  }
                  plan {
                    name
                    pricePerMonth
                    includedUsage
                  }
                }
              }
            }
          }
        }
      `;
      const railRes = await axios.post('https://backboard.railway.com/graphql/v2', { query }, {
        headers: { Authorization: `Bearer ${railwayToken}`, 'Content-Type': 'application/json' },
      });

      const workspaces = railRes.data?.data?.me?.workspaces?.edges || [];
      const ws = workspaces[0]?.node;
      results.railway = {
        status: 'ok',
        data: {
          workspaceName: ws?.name,
          currentUsageUSD: ws?.usage?.currentUsage || 0,
          estimatedUsageUSD: ws?.usage?.estimatedUsage || 0,
          billEstimateUSD: ws?.usage?.currentBillEstimate || 0,
          planName: ws?.plan?.name || 'Pro',
          planPriceUSD: ws?.plan?.pricePerMonth || 20,
          includedUsageUSD: ws?.plan?.includedUsage || 20,
          billingCycleStart: ws?.usage?.billingCycleStart,
          billingCycleEnd: ws?.usage?.billingCycleEnd,
          currentUsageMXN: Math.round((ws?.usage?.currentUsage || 0) * usdToMxn * 100) / 100,
        },
      };
    } catch (err) {
      const planCost = parseFloat(process.env.RAILWAY_MONTHLY_COST) || 20;
      results.railway = {
        status: 'estimated',
        data: {
          estimatedMonthlyCostUSD: planCost,
          estimatedMonthlyCostMXN: Math.round(planCost * usdToMxn * 100) / 100,
          error: err.message,
        },
      };
    }
  } else {
    const planCost = parseFloat(process.env.RAILWAY_MONTHLY_COST) || 20;
    results.railway = {
      status: 'estimated',
      data: { estimatedMonthlyCostUSD: planCost, estimatedMonthlyCostMXN: Math.round(planCost * usdToMxn * 100) / 100 },
    };
  }

  // ── Netlify: plan info ──
  const netlifyToken = process.env.NETLIFY_ACCESS_TOKEN;
  if (netlifyToken) {
    try {
      const [accountsRes, bandwidthRes] = await Promise.all([
        axios.get('https://api.netlify.com/api/v1/accounts', {
          headers: { Authorization: `Bearer ${netlifyToken}` },
        }),
        axios.get('https://api.netlify.com/api/v1/bandwidth', {
          headers: { Authorization: `Bearer ${netlifyToken}` },
        }).catch(() => ({ data: null })),
      ]);

      const account = accountsRes.data?.[0];
      const planCost = parseFloat(process.env.NETLIFY_MONTHLY_COST) || 9;
      results.netlify = {
        status: 'ok',
        data: {
          planType: account?.type_name || 'Personal',
          planSlug: account?.type_slug,
          planCostUSD: planCost,
          planCostMXN: Math.round(planCost * usdToMxn * 100) / 100,
          bandwidth: bandwidthRes.data,
        },
      };
    } catch (err) {
      results.netlify = { status: 'error', data: { error: err.message } };
    }
  } else {
    const planCost = parseFloat(process.env.NETLIFY_MONTHLY_COST) || 9;
    results.netlify = {
      status: 'estimated',
      data: { planCostUSD: planCost, planCostMXN: Math.round(planCost * usdToMxn * 100) / 100 },
    };
  }

  res.json({ usage: results, exchangeRate: usdToMxn });
}));

// ═══════════════════════════════════════════════════
// GET /revenue/campaigns/meta/detail — Campañas Meta con detalle completo
// Retorna campañas + adsets + ads con insights del período
// ═══════════════════════════════════════════════════
router.get('/campaigns/meta/detail', protect, adminOnly, asyncHandler(async (req, res) => {
  const { year, month, dateFrom, dateTo } = req.query;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!accessToken || !adAccountId) {
    return res.status(400).json({ error: 'META_ACCESS_TOKEN o META_AD_ACCOUNT_ID no configurados' });
  }

  // Determinar rango de fechas
  let startStr, endStr;
  if (dateFrom && dateTo) {
    startStr = dateFrom;
    endStr = dateTo;
  } else {
    const now = new Date();
    const targetYear = parseInt(year) || now.getFullYear();
    const targetMonth = month !== undefined ? parseInt(month) : now.getMonth();
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0);
    startStr = startDate.toISOString().split('T')[0];
    endStr = endDate.toISOString().split('T')[0];
  }

  try {
    // 1. Obtener campañas con estado actual + insights del período
    const campaignsRes = await axios.get(
      `https://graph.facebook.com/v21.0/act_${adAccountId}/campaigns`,
      {
        params: {
          access_token: accessToken,
          fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time',
          limit: 50,
        },
      }
    );

    const campaigns = campaignsRes.data?.data || [];

    // 2. Para cada campaña, obtener insights del período
    const campaignIds = campaigns.map(c => c.id);
    let insightsByCampaign = {};

    if (campaignIds.length > 0) {
      try {
        const insightsRes = await axios.get(
          `https://graph.facebook.com/v21.0/act_${adAccountId}/insights`,
          {
            params: {
              access_token: accessToken,
              time_range: JSON.stringify({ since: startStr, until: endStr }),
              fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,cpc,cpm,ctr,frequency,actions,cost_per_action_type,objective',
              level: 'campaign',
              limit: 100,
            },
          }
        );
        (insightsRes.data?.data || []).forEach(row => {
          const conversions = (row.actions || []).find(a =>
            ['lead', 'offsite_conversion.fb_pixel_lead', 'offsite_conversion.fb_pixel_purchase'].includes(a.action_type)
          );
          const costPerLead = (row.cost_per_action_type || []).find(a =>
            ['lead', 'offsite_conversion.fb_pixel_lead'].includes(a.action_type)
          );
          insightsByCampaign[row.campaign_id] = {
            spend: parseFloat(row.spend) || 0,
            impressions: parseInt(row.impressions) || 0,
            clicks: parseInt(row.clicks) || 0,
            reach: parseInt(row.reach) || 0,
            cpc: parseFloat(row.cpc) || 0,
            cpm: parseFloat(row.cpm) || 0,
            ctr: parseFloat(row.ctr) || 0,
            frequency: parseFloat(row.frequency) || 0,
            conversions: conversions ? parseInt(conversions.value) : 0,
            costPerLead: costPerLead ? parseFloat(costPerLead.value) : 0,
            actions: row.actions || [],
          };
        });
      } catch (insErr) {
        console.warn('[MetaCampaigns] Error fetching insights:', insErr.message);
      }
    }

    // 3. Combinar datos de estado + insights
    const enriched = campaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      effectiveStatus: c.effective_status,
      objective: c.objective || '',
      dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
      lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
      budgetRemaining: c.budget_remaining ? parseFloat(c.budget_remaining) / 100 : null,
      startTime: c.start_time,
      stopTime: c.stop_time,
      createdTime: c.created_time,
      insights: insightsByCampaign[c.id] || null,
      currency: 'MXN',
    }));

    // Totales del período
    const totals = enriched.reduce((acc, c) => {
      if (c.insights) {
        acc.spend += c.insights.spend;
        acc.impressions += c.insights.impressions;
        acc.clicks += c.insights.clicks;
        acc.conversions += c.insights.conversions;
      }
      return acc;
    }, { spend: 0, impressions: 0, clicks: 0, conversions: 0 });

    res.json({
      campaigns: enriched,
      totals,
      period: { from: startStr, to: endStr },
      adAccountId,
    });
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    console.error('[MetaCampaigns Detail] Error:', msg);
    res.status(500).json({ error: msg });
  }
}));

// ═══════════════════════════════════════════════════
// POST /revenue/campaigns/meta/:campaignId/status
// Pausa o reanuda una campaña de Meta
// Body: { action: 'pause' | 'resume' }
// ═══════════════════════════════════════════════════
router.post('/campaigns/meta/:campaignId/status', protect, adminOnly, asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const { action } = req.body;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!accessToken) {
    return res.status(400).json({ error: 'META_ACCESS_TOKEN no configurado' });
  }
  if (!['pause', 'resume'].includes(action)) {
    return res.status(400).json({ error: 'action debe ser "pause" o "resume"' });
  }

  const newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${campaignId}`,
      null,
      {
        params: {
          access_token: accessToken,
          status: newStatus,
        },
      }
    );

    res.json({
      success: response.data?.success || true,
      campaignId,
      newStatus,
      message: action === 'pause' ? 'Campaña pausada correctamente' : 'Campaña reactivada correctamente',
    });
  } catch (error) {
    const errData = error.response?.data?.error;
    const msg = errData?.message || error.message;
    const isPermission = errData?.code === 200 || msg.toLowerCase().includes('permission');
    console.error('[MetaCampaigns Status] Error:', msg);
    res.status(500).json({
      error: isPermission
        ? 'El token de Meta no tiene permiso ads_management. El sistema user tsprevenue necesita ese permiso para modificar campañas.'
        : msg,
      code: errData?.code,
    });
  }
}));

// ═══════════════════════════════════════════════════
// POST /revenue/campaigns/meta/:campaignId/budget
// Actualiza el presupuesto diario de una campaña
// Body: { dailyBudget: number } (en MXN)
// ═══════════════════════════════════════════════════
router.post('/campaigns/meta/:campaignId/budget', protect, adminOnly, asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const { dailyBudget } = req.body;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!accessToken) {
    return res.status(400).json({ error: 'META_ACCESS_TOKEN no configurado' });
  }
  if (!dailyBudget || isNaN(dailyBudget) || dailyBudget < 10) {
    return res.status(400).json({ error: 'dailyBudget inválido (mínimo $10 MXN)' });
  }

  // Meta recibe el presupuesto en centavos de la moneda de la cuenta
  const budgetInCents = Math.round(parseFloat(dailyBudget) * 100);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${campaignId}`,
      null,
      {
        params: {
          access_token: accessToken,
          daily_budget: budgetInCents,
        },
      }
    );

    res.json({
      success: response.data?.success || true,
      campaignId,
      newDailyBudget: parseFloat(dailyBudget),
      message: `Presupuesto actualizado a $${dailyBudget} MXN/día`,
    });
  } catch (error) {
    const errData = error.response?.data?.error;
    const msg = errData?.message || error.message;
    const isPermission = errData?.code === 200 || msg.toLowerCase().includes('permission');
    console.error('[MetaCampaigns Budget] Error:', msg);
    res.status(500).json({
      error: isPermission
        ? 'El token de Meta no tiene permiso ads_management. Necesario para modificar presupuestos.'
        : msg,
    });
  }
}));

// ═══════════════════════════════════════════════════
// POST /revenue/campaigns/meta/analyze
// Análisis AI avanzado de campañas: Claude analiza KPIs reales y
// genera recomendaciones accionables para mejorar leads y ventas
// ═══════════════════════════════════════════════════
router.post('/campaigns/meta/analyze', protect, adminOnly, asyncHandler(async (req, res) => {
  const { campaigns, totals, period, context } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY no configurado' });
  }
  if (!campaigns || campaigns.length === 0) {
    return res.status(400).json({ error: 'No hay datos de campañas para analizar' });
  }

  // Construir resumen de datos para Claude
  const campaignSummary = campaigns.map(c => {
    const ins = c.insights;
    return {
      nombre: c.name,
      estado: c.status,
      presupuestoDiario: c.dailyBudget,
      objetivo: c.objective,
      gasto: ins?.spend || 0,
      impresiones: ins?.impressions || 0,
      clics: ins?.clicks || 0,
      ctr: ins?.ctr || 0,
      cpc: ins?.cpc || 0,
      cpm: ins?.cpm || 0,
      alcance: ins?.reach || 0,
      frecuencia: ins?.frequency || 0,
      conversiones: ins?.conversions || 0,
      costoXLead: ins?.costPerLead || 0,
      actionsDetalle: ins?.actions?.slice(0, 5) || [],
    };
  });

  const systemPrompt = `Eres un experto en marketing digital y publicidad de Meta Ads con más de 10 años de experiencia optimizando campañas para empresas de servicios educativos en México.
Tu especialidad es maximizar la generación de leads calificados y convertirlos en ventas para servicios de alto valor (tesis, asesorías académicas).
Tesipedia vende servicios de elaboración de tesis y proyectos académicos en México, con tickets promedio de $3,000 a $15,000 MXN.
Tu análisis debe ser ESPECÍFICO, ACCIONABLE y PRÁCTICO — sin generalidades.`;

  const userPrompt = `Analiza el rendimiento de estas campañas de Meta Ads de Tesipedia para el período ${period?.from} al ${period?.to}:

DATOS GENERALES:
- Gasto total: $${totals?.spend?.toFixed(2) || 0} MXN
- Impresiones totales: ${totals?.impressions?.toLocaleString('es-MX') || 0}
- Clics totales: ${totals?.clicks?.toLocaleString('es-MX') || 0}
- Conversiones/leads: ${totals?.conversions || 0}
${context ? `\nCONTEXTO ADICIONAL DEL OPERADOR:\n${context}` : ''}

CAMPAÑAS:
${JSON.stringify(campaignSummary, null, 2)}

Por favor responde en JSON con esta estructura EXACTA:
{
  "resumenEjecutivo": "2-3 oraciones sobre el estado general de las campañas",
  "scoreGeneral": 75,
  "alertasCriticas": [
    { "tipo": "error|warning|info", "titulo": "...", "detalle": "...", "campana": "nombre o null" }
  ],
  "analisisPorCampana": [
    {
      "nombre": "...",
      "score": 80,
      "diagnostico": "...",
      "fortalezas": ["...", "..."],
      "debilidades": ["...", "..."],
      "recomendacionPrincipal": "...",
      "accionesConcretas": [
        { "accion": "...", "impacto": "alto|medio|bajo", "urgencia": "inmediata|esta-semana|este-mes", "detalle": "..." }
      ]
    }
  ],
  "estrategiaPresupuesto": {
    "analisis": "...",
    "redistribucion": [
      { "campana": "...", "accion": "aumentar|reducir|pausar|mantener", "porcentaje": 20, "justificacion": "..." }
    ]
  },
  "optimizacionAudiencias": {
    "observaciones": "...",
    "recomendaciones": ["...", "..."]
  },
  "creativosYMensajes": {
    "hipotesisDeBaja": "Por qué puede estar bajando el rendimiento",
    "recomendaciones": ["...", "..."]
  },
  "kpisObjetivo": {
    "ctrMeta": "2.5%",
    "cplMeta": "$X MXN",
    "cpcMeta": "$X MXN",
    "frecuenciaMax": 3,
    "justificacion": "..."
  },
  "planDeAccion": [
    { "orden": 1, "semana": "Esta semana", "accion": "...", "responsable": "Administrador", "metrica": "..." }
  ]
}`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const raw = message.content[0]?.text || '';
    // Extraer JSON del response (puede venir entre ```json ... ```)
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : raw;

    let analysis;
    try {
      analysis = JSON.parse(jsonStr);
    } catch {
      analysis = { raw, parseError: true };
    }

    res.json({ analysis, tokensUsed: message.usage });
  } catch (error) {
    const msg = error.message || 'Error al conectar con Claude';
    console.error('[CampaignAI] Error:', msg);
    res.status(500).json({ error: msg });
  }
}));

export default router;
