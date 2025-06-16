// Script para verificar un correo específico y crear su cuenta
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';
import GuestPayment from '../models/guestPayment.js';
import User from '../models/User.js';
import sendEmail from '../utils/emailSender.js';

// Cargar variables de entorno
dotenv.config();

// Correo específico a verificar
const TARGET_EMAIL = 'tesipedia.trabajos@gmail.com';

const createAccountForEmail = async () => {
    try {
        // Conectar a la base de datos
        console.log('🔌 Conectando a la base de datos...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión exitosa a MongoDB');

        // Buscar pagos con este correo
        console.log(`🔍 Buscando pagos para ${TARGET_EMAIL}...`);

        // Define el modelo con esquema flexible para buscar en cualquier estructura
        const GuestPaymentFlex = mongoose.model('GuestPaymentFlex', new mongoose.Schema({}, {
            strict: false,
            collection: 'guestpayments'
        }));

        // Buscar pagos con este correo (estructura antigua o nueva)
        const payments = await GuestPaymentFlex.find({
            $or: [
                { guestEmail: TARGET_EMAIL },
                { correo: TARGET_EMAIL }
            ]
        });

        console.log(`ℹ️ Se encontraron ${payments.length} pagos con el correo ${TARGET_EMAIL}`);

        if (payments.length === 0) {
            console.log(`❌ No se encontraron pagos para el correo ${TARGET_EMAIL}`);

            // Verificar si el usuario ya existe (podría haber sido creado manualmente)
            const existingUser = await User.findOne({ email: TARGET_EMAIL });
            if (existingUser) {
                console.log(`✅ Usuario ya existe con ID: ${existingUser._id}`);
                console.log(`   Nombre: ${existingUser.name}`);
                console.log(`   Correo: ${existingUser.email}`);
                console.log(`   Rol: ${existingUser.role}`);
                console.log(`   Creado: ${existingUser.createdAt}`);
            } else {
                console.log(`❓ El usuario no existe en la base de datos. ¿Desea crearlo manualmente?`);
                console.log(`   Use: node -e "const mongoose = require('mongoose'); const bcrypt = require('bcryptjs'); const dotenv = require('dotenv'); dotenv.config(); mongoose.connect(process.env.MONGO_URI).then(async () => { const User = mongoose.model('User', new mongoose.Schema({ email: String, name: String, password: String, role: String }, { timestamps: true })); const salt = await bcrypt.genSalt(10); const password = '${crypto.randomBytes(8).toString('hex')}'; const hashedPassword = await bcrypt.hash(password, salt); const user = await User.create({ email: '${TARGET_EMAIL}', name: 'Cliente Tesipedia', password: hashedPassword, role: 'cliente' }); console.log('Usuario creado:', user); console.log('Contraseña temporal:', password); process.exit(0); })"`);
            }

            process.exit(0);
        }

        // Verificar si el usuario ya existe
        const existingUser = await User.findOne({ email: TARGET_EMAIL });

        if (existingUser) {
            console.log(`✅ Usuario ya existe con ID: ${existingUser._id}`);

            // Mostrar info del usuario
            console.log(`   Nombre: ${existingUser.name}`);
            console.log(`   Correo: ${existingUser.email}`);
            console.log(`   Rol: ${existingUser.role}`);
            console.log(`   Creado: ${existingUser.createdAt}`);

            // Restablecer contraseña para este usuario
            const newPassword = crypto.randomBytes(8).toString('hex');
            existingUser.password = newPassword;
            await existingUser.save();
            console.log(`✅ Contraseña restablecida: ${newPassword}`);

            // Enviar correo con las credenciales
            const message = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="color: #2575fc; text-align: center;">🔐 Credenciales de Acceso a Tesipedia</h2>
                    <p style="font-size: 16px;">Hola <strong>${existingUser.name || 'Cliente'}</strong>,</p>
                    <p style="font-size: 16px;">Aquí están tus credenciales de acceso para Tesipedia:</p>
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>Email:</strong> ${TARGET_EMAIL}</p>
                        <p style="margin: 5px 0;"><strong>Contraseña temporal:</strong> ${newPassword}</p>
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

            try {
                const emailResult = await sendEmail({
                    to: TARGET_EMAIL,
                    subject: "🔐 Tus credenciales de acceso a Tesipedia",
                    html: message
                });

                console.log(`✅ Email enviado a ${TARGET_EMAIL}`);
            } catch (emailError) {
                console.error(`❌ Error al enviar email:`, emailError.message);
            }

        } else {
            console.log(`🔄 Creando nueva cuenta para: ${TARGET_EMAIL}`);

            // Extraer nombre del primer pago
            const payment = payments[0];
            const fullName = payment.guestName || 'Cliente Tesipedia';

            // Generar contraseña aleatoria
            const tempPassword = crypto.randomBytes(8).toString('hex');
            console.log(`🔑 Contraseña temporal generada: ${tempPassword}`);

            // Crear nuevo usuario
            const user = await User.create({
                name: fullName,
                email: TARGET_EMAIL,
                password: tempPassword,
                role: 'cliente'
            });

            console.log(`✅ Usuario creado con ID: ${user._id}`);

            // Vincular pagos al usuario creado
            for (const payment of payments) {
                try {
                    payment.userId = user._id;
                    payment.emailSent = true;
                    payment.emailSentAt = new Date();
                    await payment.save();
                    console.log(`✅ Pago ${payment._id} vinculado al usuario`);
                } catch (saveError) {
                    console.error(`⚠️ No se pudo actualizar el pago ${payment._id}:`, saveError.message);
                }
            }

            // Enviar email con credenciales
            const message = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="color: #2575fc; text-align: center;">🎉 ¡Bienvenido a Tesipedia!</h2>
                    <p style="font-size: 16px;">Hola <strong>${fullName}</strong>,</p>
                    <p style="font-size: 16px;">Tu pago ha sido procesado exitosamente y hemos creado una cuenta para ti.</p>
                    <p style="font-size: 16px;">Tus credenciales de acceso son:</p>
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>Email:</strong> ${TARGET_EMAIL}</p>
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

            try {
                const emailResult = await sendEmail({
                    to: TARGET_EMAIL,
                    subject: "🎉 ¡Bienvenido a Tesipedia! Tu cuenta ha sido creada",
                    html: message
                });

                console.log(`✅ Email enviado a ${TARGET_EMAIL}`);
            } catch (emailError) {
                console.error(`❌ Error al enviar email:`, emailError.message);
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
createAccountForEmail(); 