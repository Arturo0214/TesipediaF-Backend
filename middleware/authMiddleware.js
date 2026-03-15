// authMiddleware.js
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import asyncHandler from 'express-async-handler';

// Email del superadmin (hardcoded por seguridad)
const SUPER_ADMIN_EMAIL = 'osvaldosuarezcruz@gmail.com';

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

    // Marcar helpers en req.user para uso fácil en controladores
    req.user.isSuperAdmin = req.user.role === 'superadmin';
    req.user.isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';

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
        req.user = null;
      } else if (!req.user.isActive) {
        req.user = null;
      } else {
        req.user.isSuperAdmin = req.user.role === 'superadmin';
        req.user.isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
      }
    } catch (error) {
      req.user = null;
    }
  }

  next();
});

// Protege rutas de admin (admin + superadmin)
export const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    next();
  } else {
    res.status(403);
    throw new Error('No autorizado: se requiere rol de administrador');
  }
};

// Protege rutas exclusivas de superadmin
export const superAdminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'superadmin') {
    next();
  } else {
    res.status(403);
    throw new Error('No autorizado: se requiere rol de Super Administrador');
  }
};

// Protege rutas de escritor
export const writerOnly = (req, res, next) => {
  if (req.user && req.user.role === 'redactor') {
    next();
  } else {
    res.status(403);
    throw new Error('No autorizado: se requiere rol de escritor');
  }
};

// Protege rutas de admin o escritor
export const admin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin' || req.user.role === 'redactor')) {
    next();
  } else {
    res.status(403);
    throw new Error('No autorizado: se requiere rol de administrador o escritor');
  }
};

export const writer = (req, res, next) => {
  if (req.user && req.user.role === 'redactor') {
    next();
  } else {
    res.status(403);
    throw new Error('Not authorized as a writer');
  }
};

// Exportar la constante para usar en otros módulos
export { SUPER_ADMIN_EMAIL };
