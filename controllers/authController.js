import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';
import sendEmail from '../utils/emailSender.js';
import crypto from 'crypto';
import { SUPER_ADMIN_EMAIL } from '../middleware/authMiddleware.js';

// Helper: opciones de cookie consistentes para toda la app
const getCookieOptions = (maxAge = 365 * 24 * 60 * 60 * 1000) => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge,
    path: '/',
  };
};

// 📌 Registrar un nuevo usuario
const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('El usuario ya existe');
  }

  const user = await User.create({ name, email, password });

  if (user) {
    const token = generateToken(user);

    res.cookie('jwt', token, getCookieOptions());

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    // Enviar emails de forma asincrónica (no bloquea la respuesta)
    setImmediate(async () => {
      try {
        // 1. Email de bienvenida al usuario
        const welcomeHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #2575fc; text-align: center;">Bienvenido a Tesipedia</h2>
            <p style="font-size: 16px;">Hola <strong>${user.name}</strong>,</p>
            <p style="font-size: 16px;">Tu cuenta ha sido creada exitosamente. Ya puedes iniciar sesión y explorar nuestros servicios.</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${process.env.CLIENT_URL || 'https://tesipedia.com'}/login"
                 style="background-color: #2575fc; color: white; padding: 12px 24px; text-decoration: none; font-size: 16px; border-radius: 5px; display: inline-block;">
                 Iniciar Sesión
              </a>
            </div>
            <p style="font-size: 14px; color: #666;">Si tienes alguna pregunta, no dudes en contactarnos.</p>
            <hr>
            <p style="font-size: 12px; text-align: center; color: #888;">© 2026 Tesipedia | Todos los derechos reservados</p>
          </div>
        `;
        await sendEmail({
          to: user.email,
          subject: 'Bienvenido a Tesipedia',
          html: welcomeHtml,
        });
        console.log(`📧 Email de bienvenida enviado a ${user.email}`);
      } catch (err) {
        console.error('Error enviando email de bienvenida:', err.message);
      }

      try {
        // 2. Notificación al admin
        const adminNotifHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #2575fc; text-align: center;">Nuevo Usuario Registrado</h2>
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>Nombre:</strong> ${user.name}</p>
              <p><strong>Email:</strong> ${user.email}</p>
              <p><strong>Rol:</strong> ${user.role}</p>
              <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p>
            </div>
            <hr>
            <p style="font-size: 12px; text-align: center; color: #888;">© 2026 Tesipedia | Notificación automática</p>
          </div>
        `;
        await sendEmail({
          to: SUPER_ADMIN_EMAIL,
          subject: `Nuevo registro: ${user.name} (${user.email})`,
          html: adminNotifHtml,
        });
        console.log(`📧 Notificación de registro enviada al admin`);
      } catch (err) {
        console.error('Error enviando notificación al admin:', err.message);
      }
    });
  } else {
    res.status(400);
    throw new Error('Datos de usuario inválidos');
  }
});

// 🔑 Login (acepta email o teléfono)
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Buscar por email o por teléfono
  let user = await User.findOne({ email: email?.toLowerCase() }).select('+password');

  // Si no se encontró por email, intentar buscar por teléfono
  if (!user && email) {
    const phoneClean = email.replace(/\D/g, '');
    if (phoneClean.length >= 10) {
      const phoneVariants = [
        phoneClean,
        phoneClean.startsWith('52') ? phoneClean : `52${phoneClean}`,
        phoneClean.startsWith('52') ? phoneClean.slice(2) : phoneClean,
      ];
      user = await User.findOne({ phone: { $in: phoneVariants.filter(p => p.length > 0) } }).select('+password');
    }
  }

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Email/teléfono o contraseña incorrectos');
  }

  const token = generateToken(user);

  res.cookie('jwt', token, getCookieOptions());

  res.status(200).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    token
  });
});

// 🔒 Logout
const logout = asyncHandler(async (req, res) => {
  res.cookie('jwt', '', getCookieOptions(0));

  res.status(200).json({ message: 'Sesión cerrada exitosamente' });
});

// 👤 Perfil
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } else {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }
});

// 🔄 Actualizar perfil
const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
    });

  } else {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }
});

// 🔐 Cambiar contraseña
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);

  if (user && (await user.matchPassword(currentPassword))) {
    user.password = newPassword;
    await user.save();
    res.json({ message: 'Contraseña actualizada exitosamente' });
  } else {
    res.status(401);
    throw new Error('Contraseña actual incorrecta');
  }
});

// 🔐 Forgot Password
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  console.log(`📧 Solicitud de recuperación para email: "${email}"`);

  if (!email || typeof email !== "string") {
    console.log(`❌ Email inválido: "${email}"`);
    res.status(400);
    throw new Error("El correo electrónico es obligatorio y debe ser un texto válido.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  console.log(`🔍 Buscando usuario con email normalizado: "${normalizedEmail}"`);

  // Primero buscar con case-sensitive
  let user = await User.findOne({ email: normalizedEmail });

  // Si no se encuentra, intentar buscar con case-insensitive
  if (!user) {
    console.log(`⚠️ No se encontró exactamente, buscando case-insensitive`);
    user = await User.findOne({
      email: { $regex: new RegExp(`^${normalizedEmail}$`, 'i') }
    });
  }

  // Otra alternativa - listar todos los correos y comparar
  if (!user) {
    console.log(`⚠️ Buscando en todos los usuarios...`);
    const allUsers = await User.find({}, 'email name');
    console.log(`ℹ️ Usuarios en la base de datos:`, allUsers.map(u => ({ id: u._id, email: u.email, name: u.name })));

    // Intentar encontrar una coincidencia aproximada
    const possibleMatch = allUsers.find(u =>
      u.email && normalizedEmail &&
      u.email.toLowerCase().includes(normalizedEmail) ||
      normalizedEmail.includes(u.email.toLowerCase())
    );

    if (possibleMatch) {
      console.log(`✅ Se encontró coincidencia aproximada: ${possibleMatch.email}`);
      user = possibleMatch;
    }
  }

  if (!user) {
    console.log(`❌ No se encontró usuario para: "${normalizedEmail}"`);
    res.status(404);
    throw new Error("No se encontró una cuenta con este correo.");
  }

  console.log(`✅ Usuario encontrado: ${user._id} | ${user.email}`);

  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 3600000;
  await user.save();

  const resetUrl = `${process.env.CLIENT_URL}/auth/reset-password/${resetToken}`;
  console.log(`🔗 URL de restablecimiento: ${resetUrl}`);

  // ✅ Responde inmediatamente al frontend
  res.status(200).json({
    message: "Enviamos el enlace de restablecimiento de contraseña. Revisa tu correo en un momento."
  });

  // ✅ Enviar el correo de forma asincrónica (no bloquea el response)
  setImmediate(async () => {
    try {
      const message = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #2575fc; text-align: center;">🔒 Restablecimiento de Contraseña</h2>
            <p style="font-size: 16px;">Hola <strong>${user.name}</strong>,</p>
            <p style="font-size: 16px;">Hemos recibido una solicitud para restablecer tu contraseña.</p>
            <p style="font-size: 16px;">Haz clic en el siguiente botón para crear una nueva contraseña:</p>
            <div style="text-align: center; margin: 20px 0;">
                <a href="${resetUrl}" 
                   style="background-color: #2575fc; color: white; padding: 12px 20px; text-decoration: none; font-size: 16px; border-radius: 5px; display: inline-block;">
                   Restablecer Contraseña
                </a>
            </div>
            <p style="font-size: 14px; color: #666;">Si no solicitaste este cambio, ignora este mensaje.</p>
            <p style="font-size: 14px; color: #666;">Este enlace expirará en 1 hora.</p>
            <hr>
            <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
        </div>
      `;

      const emailResult = await sendEmail({
        to: user.email,
        subject: "🔒 Restablecimiento de Contraseña",
        html: message
      });

      console.log(`📩 Email enviado a: ${user.email} | ID: ${emailResult.messageId || 'desconocido'}`);
    } catch (error) {
      console.error(`❌ Error al enviar email de recuperación: ${error.message}`, error);
      // Opcional: guardar log en BD
    }
  });
});

// 🔁 Reset password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400);
    throw new Error('Token y contraseña son requeridos');
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    res.status(400);
    throw new Error('Token inválido o expirado');
  }

  // Actualizar la contraseña
  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  // Enviar email de confirmación
  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #2575fc; text-align: center;">✅ Contraseña Actualizada</h2>
        <p style="font-size: 16px;">Hola <strong>${user.name}</strong>,</p>
        <p style="font-size: 16px;">Tu contraseña ha sido actualizada exitosamente.</p>
        <p style="font-size: 16px;">Si no realizaste este cambio, por favor contacta a soporte inmediatamente.</p>
        <hr>
        <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Tesipedia | Todos los derechos reservados</p>
    </div>
  `;

  try {
    await sendEmail({
      to: user.email,
      subject: "✅ Contraseña Actualizada",
      html: message
    });
  } catch (error) {
    console.error('Error al enviar email de confirmación:', error);
  }

  res.status(200).json({
    message: 'Contraseña actualizada exitosamente'
  });
});

// Google OAuth (placeholder)
const googleAuth = asyncHandler(async (req, res) => {
  res.json({ message: 'Google auth endpoint' });
});

const googleCallback = asyncHandler(async (req, res) => {
  res.json({ message: 'Google callback endpoint' });
});

// 🔍 Validar token de restablecimiento
const validateResetToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  console.log('🔍 Validando token:', token);

  if (!token) {
    console.log('❌ Token no proporcionado');
    res.status(400);
    throw new Error('Token es requerido');
  }

  try {
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    console.log('🔑 Token hasheado:', hashedToken);

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    console.log('👤 Usuario encontrado:', user ? 'Sí' : 'No');
    if (user) {
      console.log('✅ Token válido para usuario:', user.email);
    }

    if (!user) {
      console.log('❌ Token inválido o expirado');
      res.status(400);
      throw new Error('Token inválido o expirado');
    }

    // Verificar si el token ha expirado
    if (user.resetPasswordExpires < Date.now()) {
      console.log('⏰ Token expirado');
      res.status(400);
      throw new Error('El token ha expirado');
    }

    console.log('✅ Token validado exitosamente');
    res.status(200).json({
      valid: true,
      message: 'Token válido'
    });
  } catch (error) {
    console.error('❌ Error al validar token:', error);
    res.status(500);
    throw new Error('Error al validar el token: ' + error.message);
  }
});

export {
  register,
  login,
  logout,
  getProfile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  validateResetToken,
  googleAuth,
  googleCallback,
};

