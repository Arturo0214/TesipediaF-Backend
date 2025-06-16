import asyncHandler from 'express-async-handler';
import stripe from '../config/stripe.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import GuestPayment from '../models/guestPayment.js';
import Notification from '../models/Notification.js';
import emailSender from '../utils/emailSender.js';

// 🔔 Webhook de Stripe
export const stripeWebhook = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // Verify the webhook signature
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log(`✅ Webhook recibido: ${event.type}`);
    } catch (err) {
        console.error(`❌ Error de webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const { orderId, trackingToken } = event.data.object.metadata;
        console.log(`🔍 Procesando evento checkout.session.completed:`, { orderId, trackingToken });

        if (trackingToken) {
            // Procesar pago de invitado
            const guestPayment = await GuestPayment.findOne({ trackingToken });
            if (guestPayment) {
                console.log(`✅ Pago de invitado encontrado: ${guestPayment._id}`);
                console.log(`📊 Estado actual del pago: ${guestPayment.paymentStatus}`);

                // Actualizar estado del pago
                guestPayment.paymentStatus = 'completed';
                guestPayment.paymentDetails = {
                    ...guestPayment.paymentDetails,
                    stripeEvent: event.data.object,
                    sessionId: event.data.object.id
                };
                await guestPayment.save();
                console.log(`✅ Estado de pago actualizado a 'completed'`);
                console.log(`📊 Nuevo estado del pago: ${guestPayment.paymentStatus}`);

                // Enviar email de confirmación al invitado
                const emailMessage = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                        <h2 style="color: #2575fc; text-align: center;">✅ Pago Confirmado</h2>
                        <p style="font-size: 16px;">Hola <strong>${guestPayment.nombres} ${guestPayment.apellidos}</strong>,</p>
                        <p style="font-size: 16px;">Tu pago ha sido confirmado exitosamente.</p>
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>Detalles del pago:</strong></p>
                            <p style="margin: 5px 0;">Monto: $${guestPayment.amount.toFixed(2)} MXN</p>
                            <p style="margin: 5px 0;">Fecha: ${new Date().toLocaleDateString()}</p>
                            <p style="margin: 5px 0;">Token de seguimiento: ${guestPayment.trackingToken}</p>
                        </div>
                        <p style="font-size: 16px;">Guarda este token de seguimiento para consultar el estado de tu pago.</p>
                        <hr>
                        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                    </div>
                `;

                await emailSender(
                    guestPayment.correo,
                    '✅ Pago Confirmado - Tesipedia',
                    emailMessage
                );
                console.log(`✅ Email de confirmación enviado a ${guestPayment.correo}`);

                // Notificar al admin
                await Notification.create({
                    user: process.env.SUPER_ADMIN_ID,
                    type: 'pago_invitado',
                    message: `💰 Nuevo pago de invitado confirmado: ${guestPayment.nombres} ${guestPayment.apellidos}`,
                    data: {
                        guestPaymentId: guestPayment._id,
                        quoteId: guestPayment.quoteId,
                        amount: guestPayment.amount,
                    },
                });
                console.log(`✅ Notificación creada para el admin`);
            } else {
                console.error(`❌ Pago de invitado no encontrado para el token: ${trackingToken}`);

                // Intentar buscar por metadata en la sesión de Stripe
                try {
                    const session = event.data.object;
                    console.log(`🔍 Intentando buscar pago por metadata en la sesión: ${session.id}`);

                    // Buscar en la base de datos por otros campos que puedan coincidir
                    const possiblePayments = await GuestPayment.find({
                        $or: [
                            { 'paymentDetails.sessionId': session.id },
                            { 'paymentDetails.metadata.trackingToken': trackingToken }
                        ]
                    });

                    if (possiblePayments.length > 0) {
                        const paymentToUpdate = possiblePayments[0];
                        console.log(`✅ Pago encontrado por otros criterios: ${paymentToUpdate._id}`);

                        paymentToUpdate.paymentStatus = 'completed';
                        paymentToUpdate.paymentDetails = {
                            ...paymentToUpdate.paymentDetails,
                            stripeEvent: session,
                            sessionId: session.id
                        };
                        await paymentToUpdate.save();
                        console.log(`✅ Estado de pago actualizado a 'completed'`);
                    }
                } catch (error) {
                    console.error(`❌ Error al buscar pago por metadata:`, error);
                }
            }
        } else if (orderId) {
            // Procesar pago normal (código existente)
            const order = await Order.findById(orderId).populate('user', 'name email');
            if (!order) {
                console.error(`❌ Pedido no encontrado: ${orderId}`);
                return res.status(404).json({ message: 'Pedido no encontrado' });
            }

            // Actualizar estado del pedido
            order.isPaid = true;
            order.paymentDate = new Date();
            order.status = 'paid';
            await order.save();
            console.log(`✅ Estado del pedido actualizado a 'paid'`);

            // Actualizar estado del pago
            const payment = await Payment.findOne({ order: orderId });
            if (payment) {
                payment.status = 'completed';
                await payment.save();
                console.log(`✅ Estado del pago actualizado a 'completed'`);
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
            console.log(`✅ Notificación creada para el cliente`);

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
            console.log(`✅ Email de confirmación enviado a ${order.user.email}`);

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
            console.log(`✅ Notificación creada para el admin`);
        }
    } else if (event.type === 'checkout.session.expired') {
        const { trackingToken } = event.data.object.metadata;

        if (trackingToken) {
            // Manejar fallo de pago de invitado
            const guestPayment = await GuestPayment.findOne({ trackingToken });
            if (guestPayment) {
                console.log(`📊 Estado actual del pago: ${guestPayment.paymentStatus}`);

                guestPayment.paymentStatus = 'failed';
                await guestPayment.save();
                console.log(`✅ Estado de pago de invitado actualizado a 'failed'`);
                console.log(`📊 Nuevo estado del pago: ${guestPayment.paymentStatus}`);

                // Enviar email de fallo al invitado
                const emailMessage = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                        <h2 style="color: #dc3545; text-align: center;">❌ Pago Fallido</h2>
                        <p style="font-size: 16px;">Hola <strong>${guestPayment.nombres} ${guestPayment.apellidos}</strong>,</p>
                        <p style="font-size: 16px;">Lo sentimos, pero el pago ha fallado.</p>
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 5px 0;">Monto: $${guestPayment.amount.toFixed(2)} MXN</p>
                        </div>
                        <p style="font-size: 16px;">Por favor, intenta realizar el pago nuevamente.</p>
                        <hr>
                        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                    </div>
                `;

                await emailSender(
                    guestPayment.correo,
                    '❌ Pago Fallido - Tesipedia',
                    emailMessage
                );
                console.log(`✅ Email de fallo enviado a ${guestPayment.correo}`);
            }
        }
    }

    res.json({ received: true });
});

// 🔄 Webhook de pagos generales
export const paymentWebhook = asyncHandler(async (req, res) => {
    const { userId, orderId, amount, status, paymentMethod } = req.body;

    // Validar datos requeridos
    if (!userId || !orderId || !amount || !status) {
        return res.status(400).json({ message: 'Faltan datos requeridos' });
    }

    try {
        // Buscar el pedido y el usuario
        const order = await Order.findById(orderId).populate('user', 'name email');
        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado' });
        }

        // Verificar que el usuario coincida
        if (order.user._id.toString() !== userId) {
            return res.status(403).json({ message: 'Usuario no autorizado' });
        }

        // Actualizar estado del pedido según el status
        switch (status) {
            case 'completed':
                order.isPaid = true;
                order.paymentDate = new Date();
                order.status = 'paid';
                await order.save();

                // Actualizar o crear registro de pago
                await Payment.findOneAndUpdate(
                    { order: orderId },
                    {
                        method: paymentMethod || 'unknown',
                        amount,
                        status: 'completed',
                        transactionId: req.body.transactionId
                    },
                    { upsert: true, new: true }
                );

                // 🔔 Crear notificación para el cliente
                await Notification.create({
                    user: userId,
                    type: 'pago',
                    message: `💰 Pago confirmado para el pedido "${order.title}"`,
                    data: {
                        orderId: order._id,
                        amount: order.price,
                    },
                });

                // 📧 Enviar email de confirmación
                const successEmail = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                        <h2 style="color: #2575fc; text-align: center;">✅ Pago Confirmado</h2>
                        <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
                        <p style="font-size: 16px;">Tu pago ha sido confirmado exitosamente.</p>
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>Detalles del pedido:</strong></p>
                            <p style="margin: 5px 0;">Título: ${order.title}</p>
                            <p style="margin: 5px 0;">Monto: $${amount.toFixed(2)} MXN</p>
                            <p style="margin: 5px 0;">Método: ${paymentMethod || 'No especificado'}</p>
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
                    successEmail
                );

                // 🔔 Notificar al admin
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
                break;

            case 'failed':
                // Actualizar estado del pago
                await Payment.findOneAndUpdate(
                    { order: orderId },
                    {
                        method: paymentMethod || 'unknown',
                        amount,
                        status: 'failed',
                        transactionId: req.body.transactionId
                    },
                    { upsert: true, new: true }
                );

                // 🔔 Notificar al cliente sobre el fallo
                await Notification.create({
                    user: userId,
                    type: 'pago',
                    message: `❌ El pago para el pedido "${order.title}" ha fallado`,
                    data: {
                        orderId: order._id,
                        amount: order.price,
                    },
                });

                // 📧 Enviar email de fallo
                const failureEmail = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                        <h2 style="color: #dc3545; text-align: center;">❌ Pago Fallido</h2>
                        <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
                        <p style="font-size: 16px;">Lo sentimos, pero el pago para tu pedido ha fallado.</p>
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>Detalles del pedido:</strong></p>
                            <p style="margin: 5px 0;">Título: ${order.title}</p>
                            <p style="margin: 5px 0;">Monto: $${amount.toFixed(2)} MXN</p>
                            <p style="margin: 5px 0;">Método: ${paymentMethod || 'No especificado'}</p>
                        </div>
                        <p style="font-size: 16px;">Por favor, intenta realizar el pago nuevamente o contacta a soporte si el problema persiste.</p>
                        <hr>
                        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                    </div>
                `;

                await emailSender(
                    order.user.email,
                    '❌ Pago Fallido - Tesipedia',
                    failureEmail
                );
                break;

            case 'pending':
                // Actualizar estado del pago a pendiente
                await Payment.findOneAndUpdate(
                    { order: orderId },
                    {
                        method: paymentMethod || 'unknown',
                        amount,
                        status: 'pending',
                        transactionId: req.body.transactionId
                    },
                    { upsert: true, new: true }
                );
                break;

            default:
                return res.status(400).json({ message: 'Estado de pago no válido' });
        }

        res.json({ message: 'Webhook procesado correctamente' });
    } catch (error) {
        console.error('Error en paymentWebhook:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
});

// 🔄 Webhook de pedidos
export const orderWebhook = asyncHandler(async (req, res) => {
    const { orderId, event, status, userId, metadata } = req.body;

    // Validar datos requeridos
    if (!orderId || !event) {
        return res.status(400).json({ message: 'Faltan datos requeridos' });
    }

    try {
        // Buscar el pedido y el usuario
        const order = await Order.findById(orderId).populate('user', 'name email');
        if (!order) {
            return res.status(404).json({ message: 'Pedido no encontrado' });
        }

        // Verificar que el usuario coincida si se proporciona
        if (userId && order.user._id.toString() !== userId) {
            return res.status(403).json({ message: 'Usuario no autorizado' });
        }

        // Procesar diferentes eventos de pedido
        switch (event) {
            case 'status_update':
                if (!status) {
                    return res.status(400).json({ message: 'Estado no proporcionado' });
                }

                // Actualizar estado del pedido
                order.status = status;
                if (status === 'processing') {
                    order.processingDate = new Date();
                } else if (status === 'completed') {
                    order.completedDate = new Date();
                } else if (status === 'cancelled') {
                    order.cancelledDate = new Date();
                }
                await order.save();

                // 🔔 Crear notificación para el cliente
                const statusMessages = {
                    processing: '🔄 Tu pedido está siendo procesado',
                    completed: '✅ Tu pedido ha sido completado',
                    cancelled: '❌ Tu pedido ha sido cancelado'
                };

                await Notification.create({
                    user: order.user._id,
                    type: 'pedido',
                    message: statusMessages[status] || `Estado del pedido actualizado a: ${status}`,
                    data: {
                        orderId: order._id,
                        status,
                        title: order.title
                    },
                });

                // 📧 Enviar email de actualización
                const statusEmailTemplates = {
                    processing: {
                        subject: '🔄 Pedido en Proceso - Tesipedia',
                        title: '🔄 Pedido en Proceso',
                        message: 'Tu pedido está siendo procesado por nuestro equipo.'
                    },
                    completed: {
                        subject: '✅ Pedido Completado - Tesipedia',
                        title: '✅ Pedido Completado',
                        message: 'Tu pedido ha sido completado exitosamente.'
                    },
                    cancelled: {
                        subject: '❌ Pedido Cancelado - Tesipedia',
                        title: '❌ Pedido Cancelado',
                        message: 'Tu pedido ha sido cancelado.'
                    }
                };

                const emailTemplate = statusEmailTemplates[status] || {
                    subject: '📦 Actualización de Pedido - Tesipedia',
                    title: '📦 Actualización de Pedido',
                    message: `El estado de tu pedido ha sido actualizado a: ${status}`
                };

                const emailMessage = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                        <h2 style="color: #2575fc; text-align: center;">${emailTemplate.title}</h2>
                        <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
                        <p style="font-size: 16px;">${emailTemplate.message}</p>
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>Detalles del pedido:</strong></p>
                            <p style="margin: 5px 0;">Título: ${order.title}</p>
                            <p style="margin: 5px 0;">Estado: ${status}</p>
                            <p style="margin: 5px 0;">Fecha: ${new Date().toLocaleDateString()}</p>
                        </div>
                        <p style="font-size: 16px;">Puedes ver el estado actual de tu pedido en tu panel de control.</p>
                        <hr>
                        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                    </div>
                `;

                await emailSender(
                    order.user.email,
                    emailTemplate.subject,
                    emailMessage
                );

                // 🔔 Notificar al admin
                await Notification.create({
                    user: process.env.SUPER_ADMIN_ID,
                    type: 'pedido',
                    message: `📦 Estado del pedido "${order.title}" actualizado a: ${status}`,
                    data: {
                        orderId: order._id,
                        userId: order.user._id,
                        status,
                        title: order.title
                    },
                });
                break;

            case 'payment_required':
                // Actualizar estado del pedido a pendiente de pago
                order.status = 'pending_payment';
                await order.save();

                // 🔔 Notificar al cliente
                await Notification.create({
                    user: order.user._id,
                    type: 'pedido',
                    message: `💰 Pago requerido para el pedido "${order.title}"`,
                    data: {
                        orderId: order._id,
                        amount: order.price,
                        title: order.title
                    },
                });

                // 📧 Enviar email de pago requerido
                const paymentEmail = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                        <h2 style="color: #2575fc; text-align: center;">💰 Pago Requerido</h2>
                        <p style="font-size: 16px;">Hola <strong>${order.user.name}</strong>,</p>
                        <p style="font-size: 16px;">Tu pedido requiere un pago para continuar con el proceso.</p>
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>Detalles del pedido:</strong></p>
                            <p style="margin: 5px 0;">Título: ${order.title}</p>
                            <p style="margin: 5px 0;">Monto: $${order.price.toFixed(2)} MXN</p>
                        </div>
                        <p style="font-size: 16px;">Por favor, realiza el pago para continuar con el proceso de tu pedido.</p>
                        <hr>
                        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                    </div>
                `;

                await emailSender(
                    order.user.email,
                    '💰 Pago Requerido - Tesipedia',
                    paymentEmail
                );
                break;

            case 'quote_requested':
                // Actualizar estado del pedido a cotización solicitada
                order.status = 'quote_requested';
                await order.save();

                // 🔔 Notificar al admin
                await Notification.create({
                    user: process.env.SUPER_ADMIN_ID,
                    type: 'cotizacion',
                    message: `📝 Nueva solicitud de cotización: "${order.title}"`,
                    data: {
                        orderId: order._id,
                        userId: order.user._id,
                        title: order.title
                    },
                });
                break;

            default:
                return res.status(400).json({ message: 'Evento de pedido no válido' });
        }

        res.json({ message: 'Webhook de pedido procesado correctamente' });
    } catch (error) {
        console.error('Error en orderWebhook:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
}); 