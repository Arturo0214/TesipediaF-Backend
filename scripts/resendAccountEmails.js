// Script para reintentar el envío de emails con credenciales para pagos completados
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';
import GuestPayment from '../models/guestPayment.js';
import User from '../models/User.js';
import sendEmail from '../utils/emailSender.js';

// Cargar variables de entorno
dotenv.config();

const findAndResendAccountEmails = async () => {
    try {
        // Conectar a la base de datos
        console.log('🔌 Conectando a la base de datos...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión exitosa a MongoDB');

        // Encontrar los pagos completados
        const paymentsToProcess = await GuestPayment.find({
            paymentStatus: 'completed',
            emailSent: { $ne: true }
        });

        console.log(`🔍 Se encontraron ${paymentsToProcess.length} pagos completados sin email enviado`);

        if (paymentsToProcess.length === 0) {
            console.log('ℹ️ No hay pagos pendientes de envío de email');
            process.exit(0);
        }

        // Procesar cada pago
        for (const payment of paymentsToProcess) {
            console.log(`\n📝 Procesando pago: ${payment._id}`);

            // Revisar si el pago tiene la estructura antigua o nueva
            let email, firstName, lastName;

            if (payment.correo) {
                // Nueva estructura
                email = payment.correo;
                firstName = payment.nombres || '';
                lastName = payment.apellidos || '';
                console.log(`📧 Correo (nueva estructura): ${email}`);
            } else if (payment.guestEmail) {
                // Estructura antigua
                email = payment.guestEmail;
                const nameParts = (payment.guestName || '').split(' ');
                firstName = nameParts[0] || '';
                lastName = nameParts.slice(1).join(' ') || '';
                console.log(`📧 Correo (estructura antigua): ${email}`);
            } else {
                console.log(`❌ No se encontró información de correo en el pago: ${payment._id}`);
                continue; // Saltar este pago
            }

            // Verificar si el correo es válido
            if (!email || !email.includes('@')) {
                console.error(`❌ Correo inválido: ${email}`);

                // Marcar este pago para revisión manual
                try {
                    payment.emailError = 'Correo inválido';
                    payment.emailRetries = (payment.emailRetries || 0) + 1;
                    await payment.save();
                } catch (saveError) {
                    console.error(`❌ Error al guardar estado de pago:`, saveError);
                }

                continue; // Pasar al siguiente pago
            }

            // Verificar si el usuario ya existe
            let user = await User.findOne({ email });

            if (!user) {
                console.log(`🔄 Creando nueva cuenta para: ${email}`);

                // Generar contraseña aleatoria
                const tempPassword = crypto.randomBytes(8).toString('hex');
                console.log(`🔑 Contraseña temporal generada: ${tempPassword}`);

                try {
                    // Crear nuevo usuario con nombre completo
                    const fullName = `${firstName} ${lastName}`.trim();
                    user = await User.create({
                        name: fullName || 'Cliente',
                        email,
                        password: tempPassword,
                        role: 'cliente'
                    });

                    console.log(`✅ Usuario creado con ID: ${user._id}`);

                    // Vincular el pago al usuario
                    payment.userId = user._id;

                    // Intentar actualizar los campos si están faltantes
                    if (!payment.correo) payment.correo = email;
                    if (!payment.nombres) payment.nombres = firstName;
                    if (!payment.apellidos) payment.apellidos = lastName;

                    payment.accountCreated = true;
                    payment.accountCreatedAt = new Date();

                    try {
                        await payment.save();
                        console.log(`✅ Pago actualizado con ID de usuario: ${user._id}`);
                    } catch (saveError) {
                        console.error(`⚠️ No se pudo actualizar el pago con campos nuevos:`, saveError.message);
                        // Continuar a pesar del error
                    }

                    // Enviar email con credenciales
                    const message = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                            <h2 style="color: #2575fc; text-align: center;">🎉 ¡Bienvenido a Tesipedia!</h2>
                            <p style="font-size: 16px;">Hola <strong>${fullName || 'cliente'}</strong>,</p>
                            <p style="font-size: 16px;">Tu pago ha sido procesado exitosamente y hemos creado una cuenta para ti.</p>
                            <p style="font-size: 16px;">Tus credenciales de acceso son:</p>
                            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
                                <p style="margin: 5px 0;"><strong>Contraseña temporal:</strong> ${tempPassword}</p>
                            </div>
                            <p style="font-size: 16px;">Por seguridad, te recomendamos cambiar tu contraseña después de iniciar sesión.</p>
                            <div style="text-align: center; margin: 20px 0;">
                                <a href="${process.env.CLIENT_URL}/login" 
                                   style="background-color: #2575fc; color: white; padding: 12px 20px; text-decoration: none; font-size: 16px; border-radius: 5px; display: inline-block;">
                                   Iniciar Sesión
                                </a>
                            </div>
                            <hr>
                            <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                        </div>
                    `;

                    const emailResult = await sendEmail({
                        to: email,
                        subject: "🎉 ¡Bienvenido a Tesipedia! Tu cuenta ha sido creada",
                        html: message
                    });

                    console.log(`✅ Email enviado a ${email}`);

                    // Actualizar el registro de pago
                    try {
                        payment.emailSent = true;
                        payment.emailSentAt = new Date();
                        await payment.save();
                    } catch (saveError) {
                        console.error(`⚠️ No se pudo actualizar el estado de email:`, saveError.message);
                    }

                } catch (userError) {
                    console.error(`❌ Error al crear usuario:`, userError.message);

                    // Intentar actualizar el pago para indicar el error
                    try {
                        payment.emailRetries = (payment.emailRetries || 0) + 1;
                        payment.emailError = userError.message;
                        await payment.save();
                    } catch (saveError) {
                        console.error(`⚠️ No se pudo actualizar el estado de error:`, saveError.message);
                    }
                }

            } else {
                console.log(`ℹ️ Usuario ya existe con ID: ${user._id}`);

                // Enviar email de recordatorio
                try {
                    const message = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                            <h2 style="color: #2575fc; text-align: center;">🎉 Pago Exitoso en Tesipedia</h2>
                            <p style="font-size: 16px;">Hola <strong>${user.name || 'cliente'}</strong>,</p>
                            <p style="font-size: 16px;">Tu pago ha sido procesado exitosamente.</p>
                            <p style="font-size: 16px;">Ya puedes iniciar sesión con tu cuenta:</p>
                            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
                            </div>
                            <p style="font-size: 16px;">Si olvidaste tu contraseña, puedes restablecerla desde la página de inicio de sesión.</p>
                            <div style="text-align: center; margin: 20px 0;">
                                <a href="${process.env.CLIENT_URL}/login" 
                                   style="background-color: #2575fc; color: white; padding: 12px 20px; text-decoration: none; font-size: 16px; border-radius: 5px; display: inline-block;">
                                   Iniciar Sesión
                                </a>
                            </div>
                            <hr>
                            <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
                        </div>
                    `;

                    const emailResult = await sendEmail({
                        to: email,
                        subject: "✅ Pago Procesado en Tesipedia",
                        html: message
                    });

                    console.log(`✅ Email de recordatorio enviado a ${email}`);

                    // Actualizar el registro de pago
                    try {
                        payment.emailSent = true;
                        payment.emailSentAt = new Date();
                        payment.userId = user._id;
                        await payment.save();
                    } catch (saveError) {
                        console.error(`⚠️ No se pudo actualizar el estado de email:`, saveError.message);
                    }

                } catch (emailError) {
                    console.error(`❌ Error al enviar email de recordatorio:`, emailError.message);

                    // Actualizar el registro con el error
                    try {
                        payment.emailRetries = (payment.emailRetries || 0) + 1;
                        payment.emailError = emailError.message;
                        await payment.save();
                    } catch (saveError) {
                        console.error(`⚠️ No se pudo actualizar el estado de error:`, saveError.message);
                    }
                }
            }
        }

        console.log('\n✅ Proceso completado');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error en el script:', error);
        process.exit(1);
    }
};

// Ejecutar la función principal
findAndResendAccountEmails(); 