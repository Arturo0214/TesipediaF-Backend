import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';

export const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies.jwt;

  if (!token) {
    res.status(401);
    throw new Error('No autorizado, token no presente');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    next();
  } catch (error) {
    console.error('🔐 Error al verificar el token:', error.message);
    res.status(401);
    throw new Error('Token inválido o mal formado');
  }
});

export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403);
    throw new Error('Acceso denegado: solo administradores');
  }
};

export const writerOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'writer' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403);
    throw new Error('Acceso denegado: solo escritores y administradores');
  }
};
