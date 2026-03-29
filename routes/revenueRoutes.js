import express from 'express';
import asyncHandler from 'express-async-handler';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import Expense from '../models/Expense.js';
import Payment from '../models/Payment.js';
import { fetchAllProviderCosts, allProviders } from '../services/costProviders.js';

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
  const [monthlyIncome, yearlyIncome] = await Promise.all([
    Payment.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Payment.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: startOfYear, $lte: endOfYear } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
  ]);

  // Ingresos por mes (para gráfica anual)
  const incomeByMonth = await Payment.aggregate([
    { $match: { status: 'completed', createdAt: { $gte: startOfYear, $lte: endOfYear } } },
    {
      $group: {
        _id: { $month: '$createdAt' },
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
    { $match: { status: 'completed', createdAt: { $gte: startOfMonth, $lte: endOfMonth }, vendedor: { $ne: '' } } },
    { $group: { _id: '$vendedor', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } }
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

  for (const expense of providerExpenses) {
    // Verificar si ya existe un gasto automático del mismo proveedor para este período
    const startOfMonth = new Date(targetYear, targetMonth, 1);
    const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

    const existing = await Expense.findOne({
      category: expense.category,
      source: { $in: ['api', 'calculated'] },
      date: { $gte: startOfMonth, $lte: endOfMonth },
      description: { $regex: expense.description.split('—')[0].trim(), $options: 'i' },
    });

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
// GET /revenue/sync-status — Estado de configuración de cada provider
// ═══════════════════════════════════════════════════
router.get('/sync-status', protect, adminOnly, asyncHandler(async (req, res) => {
  const providers = [
    {
      name: 'Anthropic API',
      category: 'claude_api',
      configured: !!process.env.ANTHROPIC_ADMIN_API_KEY,
      envVars: ['ANTHROPIC_ADMIN_API_KEY'],
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

export default router;
