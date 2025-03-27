import asyncHandler from 'express-async-handler';
import stripe from '../config/stripe.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';

// Crear sesión de pago con Stripe
export const createStripeSession = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  const order = await Order.findById(orderId);
  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'mxn',
        product_data: {
          name: order.title,
        },
        unit_amount: Math.round(order.price * 100), // Stripe usa centavos
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${process.env.CLIENT_URL}/pago-exitoso`,
    cancel_url: `${process.env.CLIENT_URL}/pago-cancelado`,
    metadata: {
      orderId: order._id.toString(),
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

  res.status(200).json({ url: session.url });
});

export const stripeWebhook = asyncHandler(async (req, res) => {
    const event = req.body;
  
    if (event.type === 'checkout.session.completed') {
      const orderId = event.data.object.metadata?.orderId;
  
      if (!orderId) {
        return res.status(400).json({ message: 'Falta el orderId en metadata' });
      }
  
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
  
      order.isPaid = true;
      order.paymentDate = new Date();
      await order.save();
  
      return res.status(200).json({ message: '✅ Pedido marcado como pagado' });
    }
  
    res.status(200).json({ received: true });
  });