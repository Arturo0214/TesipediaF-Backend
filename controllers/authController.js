import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';
import emailSender from '../utils/emailSender.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';


export const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('Este correo ya está registrado');
  }

  const user = await User.create({ name, email, password });

  if (user) {
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user),
    });
  } else {
    res.status(400);
    throw new Error('No se pudo registrar el usuario');
  }
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');

  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user),
    });
  } else {
    res.status(401);
    throw new Error('Correo o contraseña inválidos');
  }
});

export const requestPasswordReset = asyncHandler(async (req, res) => {
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

    // Generar un token seguro
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Guardar el token en la base de datos con una expiración de 1 hora
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 3600000;

    await user.save();

    // **Aquí cambiamos la URL para que apunte al FRONTEND**
    const resetUrl = `${process.env.CLIENT_URL}reset-password/${resetToken}`;

    console.log("🔗 Enlace de restablecimiento generado:", resetUrl); // Verifica en la consola

    // **Nuevo diseño del correo en HTML**
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
            <p style="font-size: 12px; text-align: center; color: #888;">© 2025 Mi Aplicación | Todos los derechos reservados</p>
        </div>
    `;

    await emailSender(user.email, "🔒 Restablecimiento de Contraseña", message);

    res.status(200).json({ message: "Se ha enviado un enlace de restablecimiento a tu correo." });
});

export const resetPassword = asyncHandler(async (req, res) => {
    console.log("🔹 Solicitud recibida en /users/reset-password/:token"); // Depuración

    const { token } = req.params;
    const { password } = req.body;

    console.log("🔹 Token recibido:", token);
    console.log("🔹 Nueva contraseña:", password);

    if (!token || !password) {
        res.status(400).json({ message: "Token y nueva contraseña requeridos." });
        return;
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({ resetPasswordToken: hashedToken, resetPasswordExpires: { $gt: Date.now() } });

    if (!user) {
        res.status(400).json({ message: "El token no es válido o ha expirado." });
        return;
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Contraseña actualizada correctamente." });
});
