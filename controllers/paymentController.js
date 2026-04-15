import asyncHandler from 'express-async-handler';
import stripe from '../config/stripe.js';
import Order from '../models/Order.js';
import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Project from '../models/Project.js';
import Notification from '../models/Notification.js';
import emailSender from '../utils/emailSender.js';
import GuestPayment from '../models/guestPayment.js';
import { generateTrackingToken } from '../utils/tokenGenerator.js';
import jwt from 'jsonwebtoken';
import { createGuestPaymentSession, checkGuestPaymentStatus as checkGuestPaymentStatusFromGuest } from './guestPaymentController.js';
import { autoCreateClientUser } from '../utils/autoCreateClient.js';
import { autoSyncProject, autoSyncPaymentSchedule } from './googleCalendarController.js';


// 💳 Crear sesión de pago con Stripe
export const createStripeSession = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const order = await Order.findById(orderId).populate('user', 'name email');

  if (!order) {
    res.status(404);
    throw new Error('Orden no encontrada');
  }

  // Verificar que el usuario que hace la petición es el dueño de la orden
  if (order.user._id.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('No autorizado: esta orden pertenece a otro usuario');
  }

  // Obtener la URL base del cliente
  const clientUrl = process.env.NODE_ENV === 'production'
    ? 'https://tesipedia.com'
    : (req.headers.origin || process.env.CLIENT_URL || 'http://localhost:5173');

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'mxn',
          product_data: {
            name: order.title,
            description: order.description
          },
          unit_amount: Math.round(order.price * 100)
        },
        quantity: 1
      }
    ],
    mode: 'payment',
    success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientUrl}/payment/cancel`,
    metadata: {
      orderId: order._id.toString()
    }
  });

  // Guardamos el intento de pago
  await Payment.create({
    order: order._id,
    method: 'stripe',
    amount: order.price,
    transactionId: session.id,
    status: 'pendiente',
  });

  res.json({ url: session.url });
});

// 🔔 Webhook de Stripe
export const stripeWebhook = asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log(`✅ Webhook recibido: ${event.type}`);
  } catch (err) {
    console.error('❌ Error verificando webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`🔍 Procesando evento checkout.session.completed:`, {
      orderId: session.metadata?.orderId,
      trackingToken: session.metadata?.trackingToken
    });

    if (session.metadata?.orderId) {
      // 🛒 PAGO NORMAL (orden existente)
      const orderId = session.metadata.orderId;
      const order = await Order.findById(orderId).populate('user', 'name email');

      if (!order) {
        console.error(`❌ Pedido no encontrado: ${orderId}`);
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }

      order.isPaid = true;
      order.paymentDate = new Date();
      order.status = 'paid';
      await order.save();
      console.log(`✅ Estado del pedido actualizado a 'paid'`);

      const payment = await Payment.findOne({ order: orderId });
      if (payment) {
        payment.status = 'completed';
        await payment.save();
        console.log(`✅ Estado del pago actualizado a 'completed'`);
      }

      // Notificaciones
      await Notification.create({
        user: order.user._id,
        type: 'pago',
        message: `💰 Pago confirmado para el pedido "${order.title}"`,
        data: {
          orderId: order._id,
          amount: order.price,
        },
      });

      await Notification.create({
        user: process.env.SUPER_ADMIN_ID,
        type: 'pago',
        message: `💰 Nuevo pago confirmado de ${order.user.name}`,
        data: {
          orderId: order._id,
          userId: order.user._id,
          amount: order.price,
        },
      });

      // Email
      const emailMessage = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #2575fc; text-align: center;">✅ Pago Confirmado</h2>
          <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
          <p style="font-size: 16px;">Tu pago ha sido confirmado exitosamente.</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Detalles del pedido:</strong></p>
            <p>Título: ${order.title}</p>
            <p>Monto: $${order.price.toFixed(2)} MXN</p>
            <p>Fecha: ${new Date().toLocaleDateString()}</p>
          </div>
          <p>Puedes ver el estado de tu pedido en tu panel de control.</p>
          <hr>
          <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
        </div>
      `;

      await emailSender(
        order.user.email,
        '✅ Pago Confirmado - Tesipedia',
        emailMessage
      );
    } else if (session.metadata?.trackingToken) {
      // 🎯 PAGO DE INVITADO
      const trackingToken = session.metadata.trackingToken;

      console.log('🔍 Buscando pago de invitado por trackingToken:', trackingToken);
      const guestPayment = await GuestPayment.findOne({ trackingToken });

      if (!guestPayment) {
        console.error('❌ Pago de invitado no encontrado por trackingToken:', trackingToken);
        return res.status(404).json({ message: 'Pago de invitado no encontrado' });
      }

      console.log('✅ Pago de invitado encontrado:', {
        id: guestPayment._id,
        status: guestPayment.paymentStatus,
        amount: guestPayment.amount
      });

      guestPayment.paymentStatus = 'completed';   // ✅ Cambia status a completed
      guestPayment.paymentDetails = {
        ...guestPayment.paymentDetails,
        sessionId: session.id,
        stripeEvent: session
      };
      await guestPayment.save();

      console.log('✅ Pago de invitado confirmado y actualizado:', {
        id: guestPayment._id,
        status: guestPayment.paymentStatus,
        amount: guestPayment.amount
      });
    } else {
      console.error('❌ No se encontró orderId ni trackingToken en metadata');
      return res.status(400).json({ message: 'No se encontró orderId ni trackingToken en metadata' });
    }
  }

  res.status(200).json({ received: true });
});

// 📋 Obtener todos los pagos (admin)
export const getPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({})
    .populate('order', 'title price')
    .sort({ createdAt: -1 });
  res.json(payments);
});

// 🔍 Obtener pago por ID (admin)
export const getPaymentById = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id)
    .populate('order', 'title price');

  if (payment) {
    res.json(payment);
  } else {
    res.status(404);
    throw new Error('Pago no encontrado');
  }
});

// 🔄 Actualizar pago (admin)
export const updatePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);

  if (payment) {
    payment.method = req.body.method || payment.method;
    payment.amount = req.body.amount || payment.amount;
    payment.transactionId = req.body.transactionId || payment.transactionId;
    payment.status = req.body.status || payment.status;
    if (req.body.vendedor !== undefined) {
      payment.vendedor = req.body.vendedor;
    }

    const updatedPayment = await payment.save();
    res.json(updatedPayment);
  } else {
    res.status(404);
    throw new Error('Pago no encontrado');
  }
});

// ❌ Eliminar pago (admin)
export const deletePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);

  if (payment) {
    await payment.deleteOne();
    res.json({ message: 'Pago eliminado correctamente' });
  } else {
    res.status(404);
    throw new Error('Pago no encontrado');
  }
});

// 👤 Obtener mis pagos
export const getMyPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ 'order.user': req.user._id })
    .populate('order', 'title price')
    .sort({ createdAt: -1 });
  res.json(payments);
});

// ✅ Manejar pago exitoso
export const handlePaymentSuccess = asyncHandler(async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    res.status(400);
    throw new Error('ID de sesión no proporcionado');
  }

  const session = await stripe.checkout.sessions.retrieve(session_id);

  if (session.payment_status !== 'paid') {
    res.status(400);
    throw new Error('El pago no ha sido completado');
  }

  res.redirect(`${process.env.CLIENT_URL}/pago-exitoso?session_id=${session_id}`);
});

// ❌ Manejar pago fallido
export const handlePaymentFailure = asyncHandler(async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    res.status(400);
    throw new Error('ID de sesión no proporcionado');
  }

  const session = await stripe.checkout.sessions.retrieve(session_id);

  // Actualizar estado del pago
  const payment = await Payment.findOne({ transactionId: session_id });
  if (payment) {
    payment.status = 'failed';
    await payment.save();
  }

  res.redirect(`${process.env.CLIENT_URL}/pago-fallido?session_id=${session_id}`);
});

// 🚫 Manejar pago cancelado
export const handlePaymentCancel = asyncHandler(async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    res.status(400);
    throw new Error('ID de sesión no proporcionado');
  }

  const session = await stripe.checkout.sessions.retrieve(session_id);

  // Actualizar estado del pago
  const payment = await Payment.findOne({ transactionId: session_id });
  if (payment) {
    payment.status = 'cancelled';
    await payment.save();
  }

  res.redirect(`${process.env.CLIENT_URL}/pago-cancelado?session_id=${session_id}`);
});

// 📊 Obtener historial de pagos
export const getPaymentHistory = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ 'order.user': req.user._id })
    .populate('order', 'title price')
    .sort({ createdAt: -1 });

  const history = payments.map(payment => ({
    id: payment._id,
    orderTitle: payment.order.title,
    amount: payment.amount,
    status: payment.status,
    method: payment.method,
    date: payment.createdAt,
    transactionId: payment.transactionId
  }));

  res.json(history);
});

// 📈 Obtener estadísticas de pagos
export const getPaymentStats = asyncHandler(async (req, res) => {
  const stats = await Payment.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ]);

  const totalPayments = await Payment.countDocuments();
  const totalAmount = await Payment.aggregate([
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  res.json({
    byStatus: stats,
    totalPayments,
    totalAmount: totalAmount[0]?.total || 0
  });
});

// 💰 Reembolsar pago
export const refundPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);

  if (!payment) {
    res.status(404);
    throw new Error('Pago no encontrado');
  }

  if (payment.status !== 'completed') {
    res.status(400);
    throw new Error('Solo se pueden reembolsar pagos completados');
  }

  try {
    const refund = await stripe.refunds.create({
      payment_intent: payment.transactionId,
      reason: req.body.reason || 'requested_by_customer'
    });

    payment.status = 'refunded';
    payment.refundId = refund.id;
    await payment.save();

    // Actualizar estado del pedido
    const order = await Order.findById(payment.order);
    if (order) {
      order.isPaid = false;
      order.paymentDate = null;
      await order.save();
    }

    await Notification.create({
      user: order.user,
      type: 'reembolso',
      message: `💰 Reembolso procesado para el pedido "${order.title}"`,
      data: {
        orderId: order._id,
        amount: payment.amount,
        refundId: refund.id
      }
    });

    res.json({ message: 'Reembolso procesado correctamente', refund });
  } catch (error) {
    res.status(400);
    throw new Error('Error al procesar el reembolso: ' + error.message);
  }
});

// 🔍 Obtener estado del reembolso
export const getRefundStatus = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);

  if (!payment) {
    res.status(404);
    throw new Error('Pago no encontrado');
  }

  if (!payment.refundId) {
    res.status(400);
    throw new Error('Este pago no tiene reembolso');
  }

  try {
    const refund = await stripe.refunds.retrieve(payment.refundId);
    res.json({ status: refund.status, refund });
  } catch (error) {
    res.status(400);
    throw new Error('Error al obtener el estado del reembolso: ' + error.message);
  }
});

// Crear pago de invitado
export const createGuestPayment = asyncHandler(async (req, res) => {
  // Redirigir a la función del guestPaymentController
  return createGuestPaymentSession(req, res);
});

// Verificar estado del pago
export const checkPaymentStatus = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  res.json({
    status: session.payment_status,
    paymentIntent: session.payment_intent
  });
});


export const checkGuestPaymentStatus = asyncHandler(async (req, res) => {
  // Redirigir a la función del guestPaymentController
  return checkGuestPaymentStatusFromGuest(req, res);
});

// 📝 Registrar pago manualmente (admin)
// También crea un proyecto vinculado y un usuario cliente automáticamente
export const createManualPayment = asyncHandler(async (req, res) => {
  const {
    clientName, clientEmail, clientPhone, title, amount, method, esquemaPago, paymentDate, notes,
    vendedor,
    // Campos de proyecto (opcionales)
    taskType, studyArea, career, educationLevel, pages, dueDate, requirements, priority,
  } = req.body;

  if (!clientName || !amount || !title) {
    res.status(400);
    throw new Error('Se requiere nombre del cliente, monto y título del proyecto');
  }

  const totalAmount = parseFloat(amount);
  const startDate = paymentDate ? new Date(paymentDate) : new Date();

  // Normalize esquema key
  const normalizeEsquemaKey = (raw) => {
    if (!raw) return 'unico';
    const lower = raw.toLowerCase();
    if (lower.includes('quincena')) return '6-quincenas';
    if (lower.includes('msi') || lower.includes('meses sin intereses')) return '6-msi';
    if (lower.includes('33%') || lower.includes('33-33') || lower.includes('33')) return '33-33-34';
    if (lower.includes('50%') || lower.includes('50-50') || lower.includes('50')) return '50-50';
    return 'unico';
  };

  const esquemaKey = normalizeEsquemaKey(esquemaPago);

  // Generate installment schedule
  const generateSchedule = (total, esquema, start) => {
    const installments = [];
    switch (esquema) {
      case '50-50':
        installments.push(
          { number: 1, amount: Math.round(total * 0.5), dueDate: new Date(start), label: '1er pago (50%)', status: 'pending' },
          { number: 2, amount: Math.round(total * 0.5), dueDate: new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000), label: '2do pago (50%)', status: 'pending' }
        );
        break;
      case '33-33-34':
        installments.push(
          { number: 1, amount: Math.round(total * 0.33), dueDate: new Date(start), label: '1er pago (33%)', status: 'pending' },
          { number: 2, amount: Math.round(total * 0.33), dueDate: new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000), label: '2do pago (33%)', status: 'pending' },
          { number: 3, amount: Math.round(total * 0.34), dueDate: new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000), label: '3er pago (34%)', status: 'pending' }
        );
        break;
      case '6-quincenas':
        for (let i = 0; i < 6; i++) {
          installments.push({
            number: i + 1,
            amount: Math.round(total / 6),
            dueDate: new Date(start.getTime() + (i * 15) * 24 * 60 * 60 * 1000),
            label: `Quincena ${i + 1}`,
            status: 'pending',
          });
        }
        const sumQ = installments.reduce((s, inst) => s + inst.amount, 0);
        if (sumQ !== total) installments[5].amount += (total - sumQ);
        break;
      case '6-msi':
        for (let i = 0; i < 6; i++) {
          installments.push({
            number: i + 1,
            amount: Math.round(total / 6),
            dueDate: new Date(start.getFullYear(), start.getMonth() + i, start.getDate()),
            label: `Mes ${i + 1} (MSI)`,
            status: 'pending',
          });
        }
        const sumM = installments.reduce((s, inst) => s + inst.amount, 0);
        if (sumM !== total) installments[5].amount += (total - sumM);
        break;
      default:
        installments.push(
          { number: 1, amount: total, dueDate: new Date(start), label: 'Pago único', status: 'paid' }
        );
    }
    return installments;
  };

  const schedule = generateSchedule(totalAmount, esquemaKey, startDate);

  // 1. Auto-crear usuario cliente si hay email
  let clientUser = null;
  if (clientEmail) {
    const { user } = await autoCreateClientUser({
      clientName: clientName || 'Cliente',
      clientEmail,
      clientPhone,
      projectTitle: title,
    });
    clientUser = user;
  }

  // 2. Crear el pago
  const payment = await Payment.create({
    amount: totalAmount,
    method: method || 'transferencia',
    status: 'completed',
    transactionId: `MANUAL-${Date.now()}`,
    currency: 'MXN',
    isManual: true,
    clientName: clientName || '',
    clientEmail: clientEmail || '',
    clientPhone: clientPhone || '',
    title: title || '',
    esquemaPago: esquemaKey,
    paymentDate: startDate,
    schedule,
    notes: notes || '',
    vendedor: vendedor || req.user?.name?.toLowerCase() || '',
  });

  // 3. Crear proyecto vinculado automáticamente
  let linkedProject = null;
  try {
    linkedProject = await Project.create({
      quote: null,
      taskType: taskType || 'Trabajo Académico',
      studyArea: studyArea || 'General',
      career: career || 'General',
      educationLevel: educationLevel || 'licenciatura',
      taskTitle: title,
      requirements: { text: requirements || 'Proyecto creado desde registro de pago' },
      pages: pages || 1,
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // default 30 días
      priority: priority || 'medium',
      status: 'pending',
      clientName: clientName || '',
      clientEmail: clientEmail || '',
      clientPhone: clientPhone || '',
      client: clientUser?._id || null,
      payment: payment._id,
    });

    // Vincular proyecto al pago
    payment.project = linkedProject._id;
    await payment.save();

    // Auto-sync al Google Calendar (fire-and-forget)
    autoSyncProject(linkedProject).catch(err => console.warn('[ManualPayment] AutoSync project error:', err.message));
  } catch (err) {
    console.error('[ManualPayment] Error creando proyecto vinculado:', err.message);
  }

  // Auto-sync parcialidades al calendario (fire-and-forget)
  autoSyncPaymentSchedule({ ...payment.toObject(), clientName, clientPhone, title }).catch(err => console.warn('[ManualPayment] AutoSync payment error:', err.message));

  res.status(201).json({
    payment,
    project: linkedProject,
    clientCreated: clientUser ? true : false,
  });
});

// 🗑️ Eliminar pago de cualquier fuente (admin) — Payment, GeneratedQuote o GuestPayment
export const deleteDashboardPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { source } = req.query; // 'stripe' | 'manual' | 'sofia' | 'guest'

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('ID de pago inválido');
  }

  let deleted = false;

  if (source === 'sofia') {
    const GeneratedQuote = (await import('../models/GeneratedQuote.js')).default;
    const doc = await GeneratedQuote.findById(id);
    if (doc) {
      await doc.deleteOne();
      deleted = true;
    }
  } else if (source === 'guest') {
    const doc = await GuestPayment.findById(id);
    if (doc) {
      await doc.deleteOne();
      deleted = true;
    }
  } else {
    // stripe or manual — both live in Payment collection
    const doc = await Payment.findById(id);
    if (doc) {
      await doc.deleteOne();
      deleted = true;
    }
  }

  if (!deleted) {
    res.status(404);
    throw new Error('Pago no encontrado');
  }

  res.json({ message: 'Pago eliminado correctamente' });
});

// 👤 Asignar vendedor a un pago de cualquier fuente (admin)
export const assignVendedor = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { source } = req.query;
  const { vendedor } = req.body;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('ID de pago inválido');
  }

  if (vendedor === undefined) {
    res.status(400);
    throw new Error('Campo vendedor es requerido');
  }

  let updated = false;

  if (source === 'sofia') {
    const GeneratedQuote = (await import('../models/GeneratedQuote.js')).default;
    // Usar updateOne con timestamps:false para no cambiar updatedAt (afecta fechas de pago)
    const result = await GeneratedQuote.updateOne(
      { _id: id },
      { $set: { vendedor } },
      { timestamps: false }
    );
    if (result.matchedCount > 0) {
      updated = true;
    }
  } else if (source === 'guest') {
    const doc = await GuestPayment.findById(id);
    if (doc) {
      doc.vendedor = vendedor;
      await doc.save();
      updated = true;
    }
  } else {
    const doc = await Payment.findById(id);
    if (doc) {
      doc.vendedor = vendedor;
      await doc.save();
      updated = true;
    }
  }

  if (!updated) {
    res.status(404);
    throw new Error('Pago no encontrado');
  }

  res.json({ message: `Vendedor asignado: ${vendedor}` });
});

// 🔗 Create project from an existing dashboard payment (for payments missing a linked project)
export const createProjectFromPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { source } = req.query;
  const { dueDate, taskType, studyArea, career, educationLevel, requirements } = req.body;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error('ID de pago inválido');
  }

  let clientName = '';
  let clientEmail = '';
  let clientPhone = '';
  let title = '';
  let amount = 0;
  let paymentRef = null; // Payment ObjectId to link to project.payment

  if (source === 'sofia') {
    const GeneratedQuote = (await import('../models/GeneratedQuote.js')).default;
    const quote = await GeneratedQuote.findById(id);
    if (!quote) { res.status(404); throw new Error('Cotización Sofia no encontrada'); }
    clientName = quote.clientName || '';
    clientEmail = quote.clientEmail || '';
    clientPhone = quote.clientPhone || '';
    title = quote.tituloTrabajo || quote.tipoTrabajo || 'Proyecto Sofia';
    amount = quote.precioConDescuento || quote.precioConRecargo || quote.precioBase || 0;
    // Check if there's already a linked Payment record auto-created by handleQuotePaid
    const autoPayment = await Payment.findOne({
      notes: { $regex: quote._id.toString() },
    });
    if (autoPayment) paymentRef = autoPayment._id;
  } else if (source === 'guest') {
    const guest = await GuestPayment.findById(id);
    if (!guest) { res.status(404); throw new Error('Pago de invitado no encontrado'); }
    clientName = `${guest.nombres || ''} ${guest.apellidos || ''}`.trim() || 'Invitado';
    clientEmail = guest.correo || '';
    clientPhone = guest.telefonoContacto || '';
    title = guest.quoteId?.taskTitle || 'Pago Invitado';
    amount = guest.amount || 0;
  } else {
    // stripe or manual — Payment model
    const payment = await Payment.findById(id);
    if (!payment) { res.status(404); throw new Error('Pago no encontrado'); }
    clientName = payment.clientName || payment.order?.user?.name || '';
    clientEmail = payment.clientEmail || '';
    clientPhone = payment.clientPhone || '';
    title = payment.title || 'Proyecto';
    amount = payment.amount || 0;
    paymentRef = payment._id;
  }

  // Check for duplicate project
  const existingProject = await Project.findOne({
    $or: [
      ...(paymentRef ? [{ payment: paymentRef }] : []),
      { clientEmail, taskTitle: title },
    ]
  });
  if (existingProject) {
    res.status(400);
    throw new Error('Ya existe un proyecto vinculado a este pago');
  }

  // Auto-create client user if email provided
  let clientUser = null;
  if (clientEmail) {
    const { user } = await autoCreateClientUser({
      clientName: clientName || 'Cliente',
      clientEmail,
      clientPhone,
      projectTitle: title,
    });
    clientUser = user;
  }

  // Determine due date — from body, or 30 days from now
  const projectDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const project = await Project.create({
    quote: null,
    generatedQuote: source === 'sofia' ? id : null,
    taskType: taskType || 'Tesis',
    studyArea: studyArea || 'General',
    career: career || 'General',
    educationLevel: educationLevel || 'licenciatura',
    taskTitle: title,
    requirements: { text: requirements || 'Proyecto creado desde pago existente' },
    pages: 1,
    dueDate: projectDueDate,
    priority: 'medium',
    status: 'pending',
    clientName,
    clientEmail,
    clientPhone,
    client: clientUser?._id || null,
    payment: paymentRef || null,
  });

  // Auto-sync al Google Calendar
  autoSyncProject(project).catch(err => console.warn('[CreateProject] AutoSync error:', err.message));

  res.status(201).json({
    project,
    message: `Proyecto "${title}" creado exitosamente`,
  });
});

// 📊 Dashboard combinado de pagos (admin) — Payments + GeneratedQuotes pagadas + GuestPayments
export const getPaymentsDashboard = asyncHandler(async (req, res) => {
  const GeneratedQuote = (await import('../models/GeneratedQuote.js')).default;

  // 1. Get all Stripe/PayPal payments (non-manual)
  const stripePayments = await Payment.find({ isManual: { $ne: true } })
    .populate({
      path: 'order',
      select: 'title price user dueDate',
      populate: { path: 'user', select: 'name email' }
    })
    .sort({ createdAt: -1 });

  // 1b. Get all manual payments
  const manualPayments = await Payment.find({ isManual: true })
    .sort({ createdAt: -1 });

  // 2. Get all paid GeneratedQuotes (Sofia quotes)
  const paidQuotes = await GeneratedQuote.find({ status: 'paid' })
    .sort({ updatedAt: -1 });

  // Backfill paidAt para cotizaciones pagadas que no lo tienen (sin tocar updatedAt)
  const quotesNeedingBackfill = paidQuotes.filter(q => !q.paidAt);
  if (quotesNeedingBackfill.length > 0) {
    for (const q of quotesNeedingBackfill) {
      // Intentar buscar el Payment vinculado (tiene la fecha real de pago)
      const linkedPayment = await Payment.findOne({
        notes: { $regex: q._id.toString() }
      }).select('paymentDate createdAt').lean();
      const bestDate = linkedPayment?.paymentDate || linkedPayment?.createdAt || q.updatedAt;
      await GeneratedQuote.updateOne(
        { _id: q._id },
        { $set: { paidAt: bestDate } },
        { timestamps: false } // No modificar updatedAt
      );
      q.paidAt = bestDate; // Actualizar en memoria para uso inmediato
    }
  }

  // 3. Get all completed GuestPayments
  const guestPayments = await GuestPayment.find({ paymentStatus: 'completed' })
    .populate('quoteId', 'taskTitle taskType estimatedPrice dueDate')
    .sort({ createdAt: -1 });

  // Helper: generate installment schedule based on esquemaPago
  const generateSchedule = (totalAmount, esquema, startDate) => {
    const start = new Date(startDate);
    const installments = [];

    switch (esquema) {
      case '50-50':
        installments.push(
          { number: 1, amount: Math.round(totalAmount * 0.5), dueDate: new Date(start), label: '1er pago (50%)' },
          { number: 2, amount: Math.round(totalAmount * 0.5), dueDate: new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000), label: '2do pago (50%)' }
        );
        break;
      case '33-33-34':
        installments.push(
          { number: 1, amount: Math.round(totalAmount * 0.33), dueDate: new Date(start), label: '1er pago (33%)' },
          { number: 2, amount: Math.round(totalAmount * 0.33), dueDate: new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000), label: '2do pago (33%)' },
          { number: 3, amount: Math.round(totalAmount * 0.34), dueDate: new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000), label: '3er pago (34%)' }
        );
        break;
      case '6-quincenas':
        for (let i = 0; i < 6; i++) {
          installments.push({
            number: i + 1,
            amount: Math.round(totalAmount / 6),
            dueDate: new Date(start.getTime() + (i * 15) * 24 * 60 * 60 * 1000),
            label: `Quincena ${i + 1}`
          });
        }
        // Adjust last installment for rounding
        const sumQ = installments.reduce((s, inst) => s + inst.amount, 0);
        if (sumQ !== totalAmount) installments[5].amount += (totalAmount - sumQ);
        break;
      case '6-msi':
        for (let i = 0; i < 6; i++) {
          installments.push({
            number: i + 1,
            amount: Math.round(totalAmount / 6),
            dueDate: new Date(start.getFullYear(), start.getMonth() + i, start.getDate()),
            label: `Mes ${i + 1} (MSI)`
          });
        }
        const sumM = installments.reduce((s, inst) => s + inst.amount, 0);
        if (sumM !== totalAmount) installments[5].amount += (totalAmount - sumM);
        break;
      default:
        // Single payment
        installments.push(
          { number: 1, amount: totalAmount, dueDate: new Date(start), label: 'Pago único' }
        );
    }
    return installments;
  };

  // Normalize esquemaPago from GeneratedQuote free text to our keys
  // IMPORTANT: check '33' before '50' because price amounts like $3,085.50 contain '50' in cents
  const normalizeEsquema = (raw) => {
    if (!raw) return 'unico';
    const lower = raw.toLowerCase();
    if (lower.includes('quincena') || lower.includes('6 quincena')) return '6-quincenas';
    if (lower.includes('msi') || lower.includes('meses sin intereses')) return '6-msi';
    if (lower.includes('33%') || lower.includes('33-33')) return '33-33-34';
    if (lower.includes('50%') || lower.includes('50-50')) return '50-50';
    return 'unico';
  };

  // Build unified payment records
  const unified = [];

  // From Stripe/PayPal payments
  for (const p of stripePayments) {
    const amount = p.amount || p.order?.price || 0;
    unified.push({
      _id: p._id,
      source: 'stripe',
      clientName: p.order?.user?.name || 'Cliente',
      clientEmail: p.order?.user?.email || '',
      clientPhone: p.order?.user?.phone || p.clientPhone || '',
      title: p.order?.title || 'Pago',
      amount,
      method: p.method,
      status: p.status,
      esquema: 'unico',
      schedule: generateSchedule(amount, 'unico', p.createdAt),
      commission: Math.round(amount * 0.15),
      date: p.createdAt,
      dueDate: p.order?.dueDate || null,
      vendedor: p.vendedor || '',
    });
  }

  // From GeneratedQuotes (Sofia paid quotes)
  for (const q of paidQuotes) {
    const amount = q.precioConDescuento || q.precioConRecargo || q.precioBase || 0;
    const esquema = normalizeEsquema(q.esquemaPago);
    // Usar paidAt (fecha exacta de pago) en vez de updatedAt (que cambia con cada edición)
    const payDate = q.paidAt || q.updatedAt;
    unified.push({
      _id: q._id,
      source: 'sofia',
      clientName: q.clientName || 'Cliente',
      clientEmail: q.clientEmail || '',
      clientPhone: q.clientPhone || '',
      title: q.tituloTrabajo || q.tipoTrabajo || 'Cotización Sofia',
      amount,
      method: q.metodoPago || 'efectivo',
      status: 'paid',
      esquema,
      esquemaRaw: q.esquemaPago || '',
      schedule: generateSchedule(amount, esquema, payDate),
      commission: Math.round(amount * 0.15),
      date: payDate,
      dueDate: q.fechaEntrega || null,
      tipoServicio: q.tipoServicio || '',
      carrera: q.carrera || '',
      vendedor: q.vendedor || '',
    });
  }

  // From GuestPayments
  for (const g of guestPayments) {
    const amount = g.amount || 0;
    unified.push({
      _id: g._id,
      source: 'guest',
      clientName: `${g.nombres || ''} ${g.apellidos || ''}`.trim() || 'Invitado',
      clientEmail: g.correo || '',
      clientPhone: g.telefonoContacto || '',
      title: g.quoteId?.taskTitle || 'Pago Invitado',
      amount,
      method: g.paymentMethod || 'stripe',
      status: 'completed',
      esquema: 'unico',
      schedule: generateSchedule(amount, 'unico', g.createdAt),
      commission: Math.round(amount * 0.15),
      date: g.createdAt,
      dueDate: g.quoteId?.dueDate || null,
      vendedor: g.vendedor || '',
    });
  }

  // Build a lookup of sofia entries to detect duplicates from auto-created manual payments
  const sofiaKeys = new Set();
  for (const q of paidQuotes) {
    const amt = q.precioConDescuento || q.precioConRecargo || q.precioBase || 0;
    const name = (q.clientName || '').trim().toLowerCase();
    const titulo = (q.tituloTrabajo || q.tipoTrabajo || '').trim().toLowerCase();
    sofiaKeys.add(`${name}|${titulo}|${amt}`);
  }

  // From Manual Payments — skip auto-generated entries that duplicate a Sofia quote
  for (const m of manualPayments) {
    const amount = m.amount || 0;
    const esquema = m.esquemaPago || 'unico';
    const notes = m.notes || '';

    // If this payment was auto-generated from a GeneratedQuote that already appears as 'sofia', skip it
    if (notes.includes('Auto-generado al marcar cotización generated')) {
      const mName = (m.clientName || '').trim().toLowerCase();
      const mTitle = (m.title || '').trim().toLowerCase();
      if (sofiaKeys.has(`${mName}|${mTitle}|${amount}`)) {
        continue; // skip duplicate
      }
    }

    unified.push({
      _id: m._id,
      source: 'manual',
      clientName: m.clientName || 'Manual',
      clientEmail: m.clientEmail || '',
      clientPhone: m.clientPhone || '',
      title: m.title || 'Pago Manual',
      amount,
      method: m.method,
      status: m.status,
      esquema,
      schedule: m.schedule && m.schedule.length > 0
        ? m.schedule
        : generateSchedule(amount, esquema, m.paymentDate || m.createdAt),
      commission: Math.round(amount * 0.15),
      date: m.paymentDate || m.createdAt,
      dueDate: null,
      notes,
      vendedor: m.vendedor || '',
    });
  }

  // --- Detect which payments already have a linked project ---
  // 1. Projects linked to a Payment _id
  const paymentIds = unified.filter(p => p.source === 'stripe' || p.source === 'manual').map(p => p._id);
  const projectsWithPayment = paymentIds.length > 0
    ? await Project.find({ payment: { $in: paymentIds } }).select('payment').lean()
    : [];
  const paymentIdsWithProject = new Set(projectsWithPayment.map(p => p.payment?.toString()));

  // 2. For sofia quotes — check if handleQuotePaid created a project (via quote ref or matching title+email)
  const sofiaIds = unified.filter(p => p.source === 'sofia').map(p => p._id);
  // handleQuotePaid creates Payment with notes containing the quote id, and Project with that payment
  // Simpler: just look for projects matching clientEmail + taskTitle
  const sofiaProjectLookup = new Map();
  if (sofiaIds.length > 0) {
    for (const p of unified.filter(u => u.source === 'sofia')) {
      const matchingProject = await Project.findOne({
        $or: [
          { clientEmail: p.clientEmail, taskTitle: p.title },
          { clientName: p.clientName, taskTitle: p.title },
        ]
      }).select('_id').lean();
      if (matchingProject) sofiaProjectLookup.set(p._id.toString(), matchingProject._id.toString());
    }
  }

  // Tag each payment with hasProject
  for (const p of unified) {
    if (p.source === 'stripe' || p.source === 'manual') {
      p.hasProject = paymentIdsWithProject.has(p._id.toString());
    } else if (p.source === 'sofia') {
      p.hasProject = sofiaProjectLookup.has(p._id.toString());
      if (p.hasProject) p.projectId = sofiaProjectLookup.get(p._id.toString());
    } else {
      p.hasProject = false;
    }
  }

  // Sort by date descending
  unified.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Filter out test data from 2025 — only keep 2026+
  const cutoffDate = new Date('2026-01-01T00:00:00Z');
  const realPayments = unified.filter(p => new Date(p.date) >= cutoffDate);

  // Calculate summary with installment tracking (only real data)
  const totalIngresos = realPayments.reduce((s, p) => s + p.amount, 0);
  const totalComisiones = realPayments.reduce((s, p) => s + p.commission, 0);
  const totalPagos = realPayments.length;

  // Calcular cobrado vs pendiente basado en parcialidades
  let cobrado = 0;
  let pendiente = 0;
  for (const p of realPayments) {
    if (!p.schedule || p.schedule.length <= 1) {
      // Pago único — todo cobrado
      cobrado += p.amount;
    } else {
      for (const inst of p.schedule) {
        if (inst.status === 'paid' || new Date(inst.dueDate) < new Date()) {
          cobrado += inst.amount || 0;
        } else {
          pendiente += inst.amount || 0;
        }
      }
    }
  }

  // --- Time-series breakdowns ---

  // Daily breakdown (last 30 days)
  const dailyMap = {};
  for (const p of realPayments) {
    const key = new Date(p.date).toISOString().slice(0, 10); // YYYY-MM-DD
    if (!dailyMap[key]) dailyMap[key] = { date: key, ingresos: 0, comisiones: 0, count: 0 };
    dailyMap[key].ingresos += p.amount;
    dailyMap[key].comisiones += p.commission;
    dailyMap[key].count += 1;
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // Weekly breakdown
  const getWeekKey = (dateStr) => {
    const d = new Date(dateStr);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };
  const weeklyMap = {};
  for (const p of realPayments) {
    const key = getWeekKey(p.date);
    if (!weeklyMap[key]) weeklyMap[key] = { week: key, ingresos: 0, comisiones: 0, count: 0 };
    weeklyMap[key].ingresos += p.amount;
    weeklyMap[key].comisiones += p.commission;
    weeklyMap[key].count += 1;
  }
  const weekly = Object.values(weeklyMap).sort((a, b) => a.week.localeCompare(b.week));

  // Monthly breakdown
  const monthlyMap = {};
  for (const p of realPayments) {
    const key = new Date(p.date).toISOString().slice(0, 7); // YYYY-MM
    if (!monthlyMap[key]) monthlyMap[key] = { month: key, ingresos: 0, comisiones: 0, count: 0 };
    monthlyMap[key].ingresos += p.amount;
    monthlyMap[key].comisiones += p.commission;
    monthlyMap[key].count += 1;
  }
  const monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));

  res.json({
    payments: realPayments,
    summary: {
      totalIngresos,
      cobrado,
      pendiente,
      totalComisiones,
      netoEmpresa: totalIngresos - totalComisiones,
      totalPagos,
    },
    daily,
    weekly,
    monthly,
  });
});

// 📊 Get sales performance by vendedor
export const getSalesByVendedor = asyncHandler(async (req, res) => {
  const { period = 'all' } = req.query;

  // Determine date range based on period
  let dateFilter = {};
  const now = new Date();

  switch (period) {
    case 'thisMonth':
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { $gte: monthStart };
      break;
    case 'last30days':
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      dateFilter = { $gte: thirtyDaysAgo };
      break;
    case 'last90days':
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      dateFilter = { $gte: ninetyDaysAgo };
      break;
    case 'all':
    default:
      // No date filter
      break;
  }

  // Apply date filter if present
  const matchStage = dateFilter.$gte
    ? { $match: { createdAt: dateFilter } }
    : { $match: {} };

  // Aggregate sales by vendedor
  const vendedorStats = await Payment.aggregate([
    matchStage,
    {
      $group: {
        _id: '$vendedor',
        totalSales: { $sum: '$amount' },
        count: { $sum: 1 },
        completedCount: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        completedAmount: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] }
        },
      }
    },
    {
      $project: {
        vendedor: '$_id',
        _id: 0,
        totalSales: 1,
        count: 1,
        completedCount: 1,
        completedAmount: 1,
        averageSale: { $cond: [{ $gt: ['$count', 0] }, { $divide: ['$totalSales', '$count'] }, 0] },
      }
    },
    { $sort: { totalSales: -1 } }
  ]);

  // Filter out empty vendedor and format
  const formattedStats = vendedorStats
    .filter(stat => stat.vendedor && stat.vendedor.trim())
    .map(stat => ({
      vendedor: stat.vendedor,
      totalSales: Math.round(stat.totalSales),
      averageSale: Math.round(stat.averageSale),
      count: stat.count,
      completedCount: stat.completedCount,
      completedAmount: Math.round(stat.completedAmount),
      conversionRate: stat.count > 0 ? (stat.completedCount / stat.count * 100).toFixed(1) : '0',
    }));

  // Calculate totals
  const grandTotal = formattedStats.reduce((sum, v) => sum + v.totalSales, 0);
  const totalTransactions = formattedStats.reduce((sum, v) => sum + v.count, 0);

  res.json({
    vendedors: formattedStats,
    summary: {
      totalSales: grandTotal,
      totalTransactions,
      totalVendedors: formattedStats.length,
    },
    period,
  });
});