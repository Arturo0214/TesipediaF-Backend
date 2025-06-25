import asyncHandler from 'express-async-handler';
import stripe from '../config/stripe.js';
import GuestPayment from '../models/guestPayment.js';
import Quote from '../models/Quote.js';
import crypto from 'crypto';
import User from '../models/User.js';
import sendEmail from '../utils/emailSender.js';

// 💳 Crear sesión de pago para invitado
export const createGuestPaymentSession = asyncHandler(async (req, res) => {
    const { quoteId, nombres, apellidos, correo, confirmaCorreo, amount } = req.body;

    console.log(`📝 Solicitud de pago recibida:`, {
        quoteId,
        nombres,
        apellidos,
        correo,
        amount
    });

    // Validaciones
    if (!nombres || nombres.length < 2) {
        console.error(`❌ Nombres inválidos: ${nombres}`);
        throw new Error('Los nombres son obligatorios y deben tener al menos 2 caracteres');
    }

    if (!apellidos || apellidos.length < 2) {
        console.error(`❌ Apellidos inválidos: ${apellidos}`);
        throw new Error('Los apellidos son obligatorios y deben tener al menos 2 caracteres');
    }

    if (!correo || !correo.includes('@')) {
        console.error(`❌ Correo inválido: ${correo}`);
        throw new Error('El correo electrónico no es válido');
    }

    if (correo !== confirmaCorreo) {
        console.error(`❌ Correos no coinciden: ${correo} vs ${confirmaCorreo}`);
        throw new Error('Los correos electrónicos no coinciden');
    }

    // Verificar que la cotización existe
    const quote = await Quote.findById(quoteId);
    if (!quote) {
        console.error(`❌ Cotización no encontrada: ${quoteId}`);
        res.status(404);
        throw new Error('Cotización no encontrada');
    }

    console.log(`✅ Cotización encontrada: ${quote._id}`);

    // Generar token de seguimiento único
    const trackingToken = crypto.randomBytes(32).toString('hex');
    console.log(`🔑 Token de seguimiento generado: ${trackingToken}`);

    // Obtener la URL base del cliente
    const clientUrl = process.env.NODE_ENV === 'production'
        ? 'https://tesipedia.com'
        : (req.headers.origin || process.env.CLIENT_URL || 'http://localhost:5173');

    try {
        // Verificar si el correo ya está registrado
        const userExists = await User.findOne({ email: correo });
        let userId = null;

        if (userExists) {
            console.log(`ℹ️ Usuario ya existe: ${userExists._id}`);
            userId = userExists._id;
        }

        // Crear sesión de Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'mxn',
                    product_data: {
                        name: `Cotización: ${quote.taskTitle || 'Tesipedia'}`,
                        description: `${quote.studyArea || ''} - ${quote.educationLevel || ''}`
                    },
                    unit_amount: Math.round(amount * 100), // Stripe usa centavos
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${clientUrl}/payment/success?tracking_token=${trackingToken}`,
            cancel_url: `${clientUrl}/payment/cancel`,
            customer_email: correo,
            metadata: {
                trackingToken,
                quoteId: quote._id.toString(),
                nombres,
                apellidos,
                correo
            }
        });
        console.log(`✅ Sesión de Stripe creada: ${session.id}`);

        // Crear registro de pago de invitado en la base de datos
        const guestPayment = await GuestPayment.create({
            quoteId: quote._id,
            userId,
            trackingToken,
            nombres,
            apellidos,
            correo,
            amount,
            paymentMethod: 'card',
            paymentStatus: 'pending',
            paymentDetails: {
                sessionId: session.id,
                sessionCreatedAt: new Date()
            }
        });

        res.status(200).json({
            message: 'Sesión de pago creada correctamente',
            trackingToken,
            sessionId: session.id,
            sessionUrl: session.url
        });
    } catch (error) {
        console.error('❌ Error al crear sesión de pago:', error);
        res.status(500);
        throw new Error('Error al crear la sesión de pago: ' + error.message);
    }
});

// Rate limiting map to prevent too many requests
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute

// 🔍 Verificar estado de pago de invitado
export const checkGuestPaymentStatus = async (req, res) => {
    try {
        const { trackingToken } = req.params;
        console.log(`🔍 Verificando estado de pago para token: ${trackingToken}`);

        // Verificar que el token sea válido
        if (!trackingToken || trackingToken.length < 10) {
            console.log(`❌ Token inválido: ${trackingToken}`);
            return res.status(400).json({
                message: 'Token de seguimiento inválido',
                status: 'error'
            });
        }

        // Rate limiting check
        const now = Date.now();
        const userRequests = rateLimitMap.get(trackingToken) || [];
        const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);

        if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
            console.log(`⚠️ Rate limit excedido para token: ${trackingToken}`);
            return res.status(429).json({
                message: 'Demasiadas solicitudes. Por favor, espera un momento.',
                retryAfter: RATE_LIMIT_WINDOW / 1000,
                status: 'rate_limited'
            });
        }

        recentRequests.push(now);
        rateLimitMap.set(trackingToken, recentRequests);

        // Buscar el pago en la base de datos
        const payment = await GuestPayment.findOne({ trackingToken });
        if (!payment) {
            console.log(`❌ Pago no encontrado para token: ${trackingToken}`);
            return res.status(404).json({
                message: 'Pago no encontrado',
                status: 'not_found'
            });
        }

        console.log(`✅ Pago encontrado:`, {
            id: payment._id,
            status: payment.paymentStatus,
            amount: payment.amount,
            createdAt: payment.createdAt
        });

        // Si el pago está pendiente, verificar con Stripe
        if (payment.paymentStatus === 'pending') {
            try {
                // Verificar que tengamos un ID de sesión de Stripe
                if (!payment.paymentDetails || !payment.paymentDetails.sessionId) {
                    console.log(`⚠️ No se encontró ID de sesión de Stripe para el pago: ${payment._id}`);

                    // Intentar buscar la sesión por metadata
                    if (payment.paymentDetails && payment.paymentDetails.metadata && payment.paymentDetails.metadata.trackingToken) {
                        console.log(`🔍 Intentando buscar sesión por metadata...`);
                        const sessions = await stripe.checkout.sessions.list({
                            limit: 10,
                            expand: ['data.payment_intent']
                        });

                        const matchingSession = sessions.data.find(session =>
                            session.metadata &&
                            session.metadata.trackingToken === trackingToken
                        );

                        if (matchingSession) {
                            console.log(`✅ Sesión encontrada por metadata: ${matchingSession.id}`);
                            if (matchingSession.payment_status === 'paid') {
                                payment.paymentStatus = 'completed';
                                payment.paymentDetails = {
                                    ...payment.paymentDetails,
                                    sessionId: matchingSession.id,
                                    stripeSession: matchingSession
                                };
                                await payment.save();
                                console.log(`✅ Estado de pago actualizado a 'completed' basado en búsqueda por metadata`);
                            }
                        }
                    }
                } else {
                    const session = await stripe.checkout.sessions.retrieve(payment.paymentDetails.sessionId);
                    console.log(`📊 Estado de sesión Stripe: ${session.payment_status}`);

                    if (session.payment_status === 'paid') {
                        payment.paymentStatus = 'completed';
                        payment.paymentDetails = {
                            ...payment.paymentDetails,
                            stripeSession: session
                        };
                        await payment.save();
                        console.log(`✅ Estado de pago actualizado a 'completed' basado en Stripe`);
                    }
                }
            } catch (stripeError) {
                console.error(`❌ Error al verificar con Stripe:`, stripeError);
                // No actualizamos el estado si hay error con Stripe
            }
        }

        // Devolver la respuesta con el formato esperado
        return res.status(200).json({
            status: payment.paymentStatus,
            amount: payment.amount,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
            message: `Estado del pago: ${payment.paymentStatus}`
        });
    } catch (error) {
        console.error(`❌ Error al verificar estado de pago:`, error);
        return res.status(500).json({
            message: 'Error al verificar estado de pago',
            status: 'error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ✅ Webhook para actualizar estado de pago de invitado
export const guestPaymentWebhook = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    console.log('📩 Webhook recibido de Stripe');

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log(`✅ Evento de Stripe validado: ${event.type}`);
    } catch (err) {
        console.error('❌ Error verificando la firma del webhook:', err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    // Manejar el evento de pago completado
    if (event.type === 'checkout.session.completed') {
        console.log('💰 Evento de pago completado detectado');

        // Extraer datos del cliente del evento
        const session = event.data.object;
        const { trackingToken, nombres, apellidos, correo } = session.metadata || {};

        console.log(`📊 Datos del cliente en el webhook:`, {
            trackingToken,
            nombres,
            apellidos,
            correo,
            sessionId: session.id,
            paymentStatus: session.payment_status
        });

        // Validar que tenemos los datos necesarios
        if (!trackingToken || !correo) {
            console.error('❌ Datos incompletos en el webhook:', { trackingToken, correo });
            return res.json({ received: true, error: 'Datos incompletos' });
        }

        // Actualizar el registro de pago
        try {
            const guestPayment = await GuestPayment.findOne({ trackingToken });

            if (!guestPayment) {
                console.error(`❌ No se encontró registro de pago con token: ${trackingToken}`);
                return res.json({ received: true, error: 'Pago no encontrado' });
            }

            console.log(`✅ Pago encontrado: ${guestPayment._id}`);

            guestPayment.paymentStatus = 'completed';
            guestPayment.paymentDetails = {
                ...guestPayment.paymentDetails,
                stripeEvent: event.data.object
            };

            await guestPayment.save();
            console.log("✅ Pago actualizado como COMPLETADO");

            // Enviar email de confirmación de pago
            try {
                const message = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                        <h2 style="color: #2575fc; text-align: center;">✅ ¡Pago Confirmado!</h2>
                        <p style="font-size: 16px;">Hola <strong>${nombres || 'cliente'}</strong>,</p>
                        <p style="font-size: 16px;">Tu pago ha sido procesado exitosamente.</p>
                        <p style="font-size: 16px;">Detalles del pago:</p>
                        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>Monto:</strong> $${(session.amount_total / 100).toFixed(2)} MXN</p>
                            <p style="margin: 5px 0;"><strong>Fecha:</strong> ${new Date().toLocaleDateString()}</p>
                        </div>
                        <p style="font-size: 16px;">Nuestro equipo revisará tu pago y te enviará un correo con las instrucciones para acceder a tu cuenta.</p>
                        <hr>
                        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                    </div>
                `;

                const emailResult = await sendEmail({
                    to: correo,
                    subject: "✅ Pago Confirmado - Tesipedia",
                    html: message
                });

                console.log(`✅ Email de confirmación enviado a ${correo} con ID: ${emailResult.messageId}`);

                // Guardar en el registro de pago que se envió el email
                guestPayment.emailSent = true;
                guestPayment.emailSentAt = new Date();
                await guestPayment.save();

            } catch (emailError) {
                console.error(`❌ Error al enviar email de confirmación:`, emailError);
            }

        } catch (paymentUpdateError) {
            console.error(`❌ Error al actualizar el pago:`, paymentUpdateError);
        }
    }

    // Siempre responder 200 a Stripe independientemente de errores internos
    res.status(200).json({ received: true });
});

// 📋 Obtener todos los pagos de invitados (admin)
export const getAllGuestPayments = asyncHandler(async (req, res) => {
    const payments = await GuestPayment.find()
        .populate('quoteId', 'taskTitle estimatedPrice')
        .sort({ createdAt: -1 });
    res.json(payments);
});

// 🔍 Obtener pago de invitado por ID (admin)
export const getGuestPaymentById = asyncHandler(async (req, res) => {
    const payment = await GuestPayment.findById(req.params.id)
        .populate('quoteId', 'taskTitle estimatedPrice');

    if (payment) {
        res.json(payment);
    } else {
        res.status(404);
        throw new Error('Pago de invitado no encontrado');
    }
}); 