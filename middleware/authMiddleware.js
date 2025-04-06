// authMiddleware.js
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import asyncHandler from 'express-async-handler';

// Protege rutas normales
export const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        res.status(401);
        throw new Error('No autorizado, token no presente');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select('-password');
        next();
    } catch (error) {
        console.error(error);
        res.status(401);
        throw new Error('No autorizado, token inválido');
    }
});

// Protege solo si hay token (sino, deja pasar)
export const optionalAuth = asyncHandler(async (req, res, next) => {
    let token;

    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
        } catch (error) {
            console.error('Token inválido pero continuamos sin usuario:', error.message);
            // No tiramos error, solo seguimos sin req.user
        }
    }

    next();
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
