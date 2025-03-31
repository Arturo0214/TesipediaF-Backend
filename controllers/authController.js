import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';
import sendEmail from '../utils/emailSender.js';
import crypto from 'crypto';

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

    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } else {
    res.status(400);
    throw new Error('Datos de usuario inválidos');
  }
});

// 🔑 Login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Email o contraseña incorrectos');
  }

  const token = generateToken(user);

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
  });

  res.status(200).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});

// 🔒 Logout
const logout = asyncHandler(async (req, res) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
  });

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

  if (!email || typeof email !== "string") {
    res.status(400);
    throw new Error("El correo electrónico es obligatorio y debe ser un texto válido.");
  }

  const user = await User.findOne({ email: email.trim() });

  if (!user) {
    res.status(404);
    throw new Error("No se encontró una cuenta con este correo.");
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 3600000;
  await user.save();

  const resetUrl = `${process.env.CLIENT_URL}reset-password/${resetToken}`;

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

      await sendEmail({
        to: user.email,
        subject: "🔒 Restablecimiento de Contraseña",
        html: message
      });

      console.log("📩 Email enviado a:", user.email);
    } catch (error) {
      console.error("❌ Error al enviar email de recuperación:", error.message);
      // Opcional: guardar log en BD
    }
  });
});

// 🔁 Reset password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    res.status(400);
    throw new Error('Token inválido o expirado');
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  await user.save();

  res.json({ message: 'Contraseña restablecida exitosamente' });
});

// Google OAuth (placeholder)
const googleAuth = asyncHandler(async (req, res) => {
  res.json({ message: 'Google auth endpoint' });
});

const googleCallback = asyncHandler(async (req, res) => {
  res.json({ message: 'Google callback endpoint' });
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
  googleAuth,
  googleCallback,
};

