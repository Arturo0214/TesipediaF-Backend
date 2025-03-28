import asyncHandler from 'express-async-handler';
import stripe from '../config/stripe.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Notification from '../models/Notification.js';
import emailSender from '../utils/emailSender.js';

// 🔔 Webhook de Stripe
export const stripeWebhook = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(`❌ Error de webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const orderId = event.data.object.metadata?.orderId;

        if (!orderId) {
            return res.status(400).json({ message: 'Falta el orderId en metadata' });
        }

        const order = await Order.findById(orderId).populate('user', 'name email');
        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado' });
        }

        // Actualizar estado del pedido
        order.isPaid = true;
        order.paymentDate = new Date();
        order.status = 'paid';
        await order.save();

        // Actualizar estado del pago
        const payment = await Payment.findOne({ order: orderId });
        if (payment) {
            payment.status = 'completed';
            await payment.save();
        }

        // 🔔 Crear notificación para el cliente
        await Notification.create({
            user: order.user._id,
            type: 'pago',
            message: `💰 Pago confirmado para el pedido "${order.title}"`,
            data: {
                orderId: order._id,
                amount: order.price,
            },
        });

        // 📧 Enviar email de confirmación al cliente
        const emailMessage = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #2575fc; text-align: center;">✅ Pago Confirmado</h2>
        <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
        <p style="font-size: 16px;">Tu pago ha sido confirmado exitosamente.</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Detalles del pedido:</strong></p>
          <p style="margin: 5px 0;">Título: ${order.title}</p>
          <p style="margin: 5px 0;">Monto: $${order.price.toFixed(2)} MXN</p>
          <p style="margin: 5px 0;">Fecha: ${new Date().toLocaleDateString()}</p>
        </div>
        <p style="font-size: 16px;">Puedes ver el estado de tu pedido en tu panel de control.</p>
        <hr>
        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
      </div>
    `;

        await emailSender(
            order.user.email,
            '✅ Pago Confirmado - Tesipedia',
            emailMessage
        );

        // 🔔 Crear notificación para el admin
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
    } else if (event.type === 'payment_intent.payment_failed') {
        const orderId = event.data.object.metadata?.orderId;
        if (orderId) {
            const order = await Order.findById(orderId).populate('user', 'name email');
            if (order) {
                // 🔔 Notificar al cliente sobre el fallo
                await Notification.create({
                    user: order.user._id,
                    type: 'pago',
                    message: `❌ El pago para el pedido "${order.title}" ha fallado`,
                    data: {
                        orderId: order._id,
                        amount: order.price,
                    },
                });

                // 📧 Enviar email de fallo al cliente
                const emailMessage = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #dc3545; text-align: center;">❌ Pago Fallido</h2>
            <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
            <p style="font-size: 16px;">Lo sentimos, pero el pago para tu pedido ha fallado.</p>
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Detalles del pedido:</strong></p>
              <p style="margin: 5px 0;">Título: ${order.title}</p>
              <p style="margin: 5px 0;">Monto: $${order.price.toFixed(2)} MXN</p>
            </div>
            <p style="font-size: 16px;">Por favor, intenta realizar el pago nuevamente o contacta a soporte si el problema persiste.</p>
            <hr>
            <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
          </div>
        `;

                await emailSender(
                    order.user.email,
                    '❌ Pago Fallido - Tesipedia',
                    emailMessage
                );
            }
        }
    }

    res.json({ received: true });
});

// 🔄 Webhook de pagos generales
export const paymentWebhook = asyncHandler(async (req, res) => {
    // Implementar lógica para otros webhooks de pago
    res.json({ received: true });
});

// 🔄 Webhook de pedidos
export const orderWebhook = asyncHandler(async (req, res) => {
    // Implementar lógica para webhooks de pedidos
    res.json({ received: true });
}); 