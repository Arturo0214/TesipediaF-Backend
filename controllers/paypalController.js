import asyncHandler from 'express-async-handler';
import checkoutNodeJssdk from '@paypal/checkout-server-sdk';
const Orders = checkoutNodeJssdk.orders;

import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Notification from '../models/Notification.js';
import emailSender from '../utils/emailSender.js';

const Environment = process.env.NODE_ENV === 'production'
  ? checkoutNodeJssdk.core.LiveEnvironment
  : checkoutNodeJssdk.core.SandboxEnvironment;

const client = new checkoutNodeJssdk.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// 💳 Crear orden de pago con PayPal
export const createPayPalOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
        res.status(404);
        throw new Error('Pedido no encontrado');
    }

    const request = new Orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'MXN',
          value: order.price.toString()
        },
        description: order.title,
        custom_id: order._id.toString()
      }],
      application_context: {
        brand_name: 'Tesipedia',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: `${process.env.CLIENT_URL}/pago-paypal-exitoso`,
        cancel_url: `${process.env.CLIENT_URL}/pago-paypal-cancelado`
      }
    });

    try {
        const paypalOrder = await client.execute(request);

        // Guardar el intento de pago
        await Payment.create({
            order: order._id,
            method: 'paypal',
            amount: order.price,
            transactionId: paypalOrder.result.id,
            status: 'pendiente',
            paypalOrderId: paypalOrder.result.id
        });

        res.json({
            orderId: paypalOrder.result.id,
            approvalUrl: paypalOrder.result.links.find(link => link.rel === 'approve').href
        });
    } catch (error) {
        console.error('Error al crear orden de PayPal:', error);
        res.status(500);
        throw new Error('Error al crear la orden de PayPal');
    }
});

// 🔔 Capturar pago de PayPal
export const capturePayPalPayment = asyncHandler(async (req, res) => {
    const { orderId } = req.body;

    try {
        const capture = await client.execute({
            path: `/v2/checkout/orders/${orderId}/capture`,
            method: 'POST'
        });

        // Buscar el pago y el pedido asociados
        const payment = await Payment.findOne({ paypalOrderId: orderId });
        if (!payment) {
            res.status(404);
            throw new Error('Pago no encontrado');
        }

        const order = await Order.findById(payment.order).populate('user', 'name email');
        if (!order) {
            res.status(404);
            throw new Error('Pedido no encontrado');
        }

        // Actualizar estado del pago
        payment.status = 'completed';
        payment.paypalCaptureId = capture.result.purchase_units[0].payments.captures[0].id;
        await payment.save();

        // Actualizar estado del pedido
        order.isPaid = true;
        order.paymentDate = new Date();
        order.status = 'paid';
        await order.save();

        // 🔔 Crear notificación para el cliente
        await Notification.create({
            user: order.user._id,
            type: 'pago',
            message: `💰 Pago con PayPal confirmado para el pedido "${order.title}"`,
            data: {
                orderId: order._id,
                amount: order.price,
            },
        });

        // 📧 Enviar email de confirmación
        const emailMessage = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #2575fc; text-align: center;">✅ Pago con PayPal Confirmado</h2>
                <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
                <p style="font-size: 16px;">Tu pago con PayPal ha sido confirmado exitosamente.</p>
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
            '✅ Pago con PayPal Confirmado - Tesipedia',
            emailMessage
        );

        // 🔔 Crear notificación para el admin
        await Notification.create({
            user: process.env.SUPER_ADMIN_ID,
            type: 'pago',
            message: `💰 Nuevo pago con PayPal confirmado de ${order.user.name}`,
            data: {
                orderId: order._id,
                userId: order.user._id,
                amount: order.price,
            },
        });

        res.json({ message: 'Pago capturado exitosamente' });
    } catch (error) {
        console.error('Error al capturar pago de PayPal:', error);
        res.status(500);
        throw new Error('Error al capturar el pago de PayPal');
    }
});

// 💰 Reembolsar pago de PayPal
export const refundPayPalPayment = asyncHandler(async (req, res) => {
    const payment = await Payment.findById(req.params.id);

    if (!payment) {
        res.status(404);
        throw new Error('Pago no encontrado');
    }

    if (payment.status !== 'completed' || !payment.paypalCaptureId) {
        res.status(400);
        throw new Error('Solo se pueden reembolsar pagos completados con PayPal');
    }

    try {
        const refund = await client.execute({
            path: `/v2/payments/captures/${payment.paypalCaptureId}/refund`,
            method: 'POST',
            body: {
                amount: {
                    value: payment.amount.toString(),
                    currency_code: 'MXN'
                },
                note_to_payer: req.body.reason || 'Reembolso solicitado por el cliente'
            }
        });

        payment.status = 'refunded';
        payment.refundId = refund.result.id;
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
            message: `💰 Reembolso de PayPal procesado para el pedido "${order.title}"`,
            data: {
                orderId: order._id,
                amount: payment.amount,
                refundId: refund.result.id
            }
        });

        res.json({ message: 'Reembolso procesado correctamente', refund: refund.result });
    } catch (error) {
        console.error('Error al reembolsar pago de PayPal:', error);
        res.status(500);
        throw new Error('Error al procesar el reembolso de PayPal');
    }
});

// 🔍 Obtener estado del reembolso de PayPal
export const getPayPalRefundStatus = asyncHandler(async (req, res) => {
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
        const refund = await client.execute({
            path: `/v2/payments/refunds/${payment.refundId}`,
            method: 'GET'
        });
        res.json({ status: refund.result.status, refund: refund.result });
    } catch (error) {
        console.error('Error al obtener estado del reembolso de PayPal:', error);
        res.status(500);
        throw new Error('Error al obtener el estado del reembolso de PayPal');
    }
}); 