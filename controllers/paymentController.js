import asyncHandler from 'express-async-handler';
import stripe from '../config/stripe.js';
import Order from '../models/Order.js';
import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Notification from '../models/Notification.js';
import emailSender from '../utils/emailSender.js';
import GuestPayment from '../models/guestPayment.js';
import { generateTrackingToken } from '../utils/tokenGenerator.js';
import jwt from 'jsonwebtoken';
import { createGuestPaymentSession, checkGuestPaymentStatus as checkGuestPaymentStatusFromGuest } from './guestPaymentController.js';


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
    success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
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