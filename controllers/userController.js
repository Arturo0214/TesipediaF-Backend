import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import { SUPER_ADMIN_EMAIL } from '../middleware/authMiddleware.js';

// 👤 Obtener perfil del usuario autenticado
export const getUserProfile = asyncHandler(async (req, res) => {
  const user = req.user;

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
export const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }

  user.name = req.body.name || user.name;

  if (req.body.password) {
    user.password = req.body.password;
  }

  const updatedUser = await user.save();

  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    role: updatedUser.role,
    token: null,
  });
});

// 👥 Obtener todos los usuarios (admin)
export const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({}).select('-password');
  res.json(users);
});

// 👤 Obtener usuario por ID (admin)
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');
  if (user) {
    res.json(user);
  } else {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }
});

// 🔄 Actualizar usuario (admin)
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }

  // Proteger superadmin: solo superadmin puede editar a otro superadmin
  if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('No puedes modificar al Super Administrador');
  }

  user.name = req.body.name || user.name;
  user.email = req.body.email || user.email;

  if (req.body.role) {
    if (req.body.role === 'superadmin' && req.user.role !== 'superadmin') {
      res.status(403);
      throw new Error('Solo el Super Admin puede asignar el rol de Super Admin');
    }
    user.role = req.body.role;
  }

  const updatedUser = await user.save();

  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    role: updatedUser.role,
  });
});

// ❌ Eliminar usuario (admin)
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }

  // Nunca permitir eliminar superadmin
  if (user.role === 'superadmin') {
    res.status(403);
    throw new Error('El Super Administrador no puede ser eliminado');
  }

  // Solo superadmin puede eliminar admins
  if (user.role === 'admin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('Solo el Super Admin puede eliminar administradores');
  }

  await user.deleteOne();
  res.json({ message: 'Usuario eliminado correctamente' });
});

// 🔍 Buscar usuarios
export const searchUsers = asyncHandler(async (req, res) => {
  const { query } = req.query;
  const users = await User.find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { email: { $regex: query, $options: 'i' } },
    ],
  }).select('-password');
  res.json(users);
});

// 🔄 Actualizar rol de usuario (admin)
export const updateUserRole = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }

  // Proteger superadmin
  if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('No puedes cambiar el rol del Super Administrador');
  }

  const { role } = req.body;

  // Solo superadmin puede asignar rol superadmin
  const allowedRoles = req.user.role === 'superadmin'
    ? ['cliente', 'admin', 'redactor', 'superadmin']
    : ['cliente', 'admin', 'redactor'];

  if (!allowedRoles.includes(role)) {
    res.status(400);
    throw new Error(`Rol inválido. Los roles válidos son: ${allowedRoles.join(', ')}`);
  }

  user.role = role;
  await user.save();

  res.json({
    message: `Rol del usuario actualizado a ${user.role}`,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    },
  });
});

// 🔄 Actualizar estado de usuario (admin)
export const updateUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }

  // Nunca desactivar superadmin desde un admin normal
  if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('No puedes desactivar al Super Administrador');
  }

  user.isActive = req.body.isActive ?? user.isActive;
  await user.save();

  res.json({
    message: `Estado del usuario actualizado a ${user.isActive ? 'activo' : 'inactivo'}`,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    },
  });
});