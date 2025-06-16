// authMiddleware.js
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import asyncHandler from 'express-async-handler';

// Protege rutas normales
export const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies.jwt) {
    token = req.cookies.jwt;
  } else if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401);
    throw new Error('No autorizado: token no presente');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      res.status(401);
      throw new Error('No autorizado: usuario no encontrado');
    }

    if (!req.user.isActive) {
      res.status(401);
      throw new Error('No autorizado: cuenta desactivada');
    }

    next();
  } catch (error) {
    res.status(401);
    throw new Error('No autorizado: token inválido o expirado');
  }
});

// Protege solo si hay token (sino, deja pasar)
export const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies.jwt) {
    token = req.cookies.jwt;
  } else if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        // Si el usuario no existe, continuamos sin autenticación
        req.user = null;
      } else if (!req.user.isActive) {
        // Si la cuenta está desactivada, continuamos sin autenticación
        req.user = null;
      }
    } catch (error) {
      // Si hay error en el token, continuamos sin autenticación
      req.user = null;
    }
  }

  // Siempre continuamos, con o sin usuario autenticado
  next();
});

// Protege rutas de admin
export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403);
    throw new Error('No autorizado: se requiere rol de administrador');
  }
};

// Protege rutas de escritor
export const writerOnly = (req, res, next) => {
  if (req.user && req.user.role === 'writer') {
    next();
  } else {
    res.status(403);
    throw new Error('No autorizado: se requiere rol de escritor');
  }
};

// Protege rutas de admin o escritor
export const admin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'writer')) {
    next();
  } else {
    res.status(403);
    throw new Error('No autorizado: se requiere rol de administrador o escritor');
  }
};
