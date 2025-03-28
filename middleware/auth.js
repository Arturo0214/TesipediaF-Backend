import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';

// Protege rutas - requiere autenticación
const protect = asyncHandler(async (req, res, next) => {
    let token;

    // Obtener token del header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Obtener usuario del token
            req.user = await User.findById(decoded.id).select('-password');

            if (!req.user) {
                res.status(401);
                throw new Error('No autorizado, token inválido');
            }

            next();
        } catch (error) {
            console.error(error);
            res.status(401);
            throw new Error('No autorizado, token fallido');
        }
    }

    if (!token) {
        res.status(401);
        throw new Error('No autorizado, no hay token');
    }
});

// Middleware para rutas de admin
const admin = asyncHandler(async (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(401);
        throw new Error('No autorizado como administrador');
    }
});

// Middleware para rutas de escritor
const writer = asyncHandler(async (req, res, next) => {
    if (req.user && (req.user.role === 'writer' || req.user.role === 'admin')) {
        next();
    } else {
        res.status(401);
        throw new Error('No autorizado como escritor');
    }
});

export { protect, admin, writer }; 