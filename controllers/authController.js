import asyncHandler from 'express-async-handler';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';
import sendEmail from '../utils/emailSender.js'; // ✅ corregido aquí

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
    const verificationToken = generateToken(user._id, '24h');
    user.verificationToken = verificationToken;
    await user.save();

    await sendEmail({
      to: user.email,
      subject: 'Verifica tu cuenta',
      text: `Por favor verifica tu cuenta haciendo clic en el siguiente enlace: ${process.env.FRONTEND_URL}/verify-email/${verificationToken}`,
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error('Datos de usuario inválidos');
  }
});

// 🔑 Login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (user && (await user.matchPassword(password))) {
    if (!user.isVerified) {
      res.status(401);
      throw new Error('Por favor verifica tu cuenta primero');
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } else {
    res.status(401);
    throw new Error('Email o contraseña incorrectos');
  }
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

// 🔑 Forgot Password
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (user) {
    const resetToken = generateToken(user._id, '1h');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpire = Date.now() + 3600000;
    await user.save();

    await sendEmail({
      to: user.email,
      subject: 'Recuperación de contraseña',
      text: `Para recuperar tu contraseña, haz clic en el siguiente enlace: ${process.env.FRONTEND_URL}/reset-password/${resetToken}`,
    });
  }

  res.json({ message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña' });
});

// 🔁 Reset password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findOne({
    _id: decoded.id,
    resetPasswordToken: token,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (user) {
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();
    res.json({ message: 'Contraseña restablecida exitosamente' });
  } else {
    res.status(400);
    throw new Error('Token inválido o expirado');
  }
});

// ✅ Verificación de email
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findOne({
    _id: decoded.id,
    verificationToken: token,
  });

  if (user) {
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    res.json({ message: 'Email verificado exitosamente' });
  } else {
    res.status(400);
    throw new Error('Token de verificación inválido');
  }
});

// 🔄 Reenviar verificación
const resendVerificationEmail = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (user && !user.isVerified) {
    const verificationToken = generateToken(user._id, '24h');
    user.verificationToken = verificationToken;
    await user.save();

    await sendEmail({
      to: user.email,
      subject: 'Verifica tu cuenta',
      text: `Por favor verifica tu cuenta haciendo clic en el siguiente enlace: ${process.env.FRONTEND_URL}/verify-email/${verificationToken}`,
    });

    res.json({ message: 'Email de verificación reenviado' });
  } else {
    res.status(400);
    throw new Error('Usuario no encontrado o ya verificado');
  }
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
  verifyEmail,
  resendVerificationEmail,
  googleAuth,
  googleCallback,
};
