import asyncHandler from 'express-async-handler';

// Middleware para manejar errores asíncronos
export const asyncErrorHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

// Middleware para manejar errores de forma global
export const globalErrorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Si el error tiene un código de estado definido, usarlo
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Error interno del servidor';

    // Errores de validación de Mongoose
    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(error => error.message);
        return res.status(400).json({
            success: false,
            message: 'Error de validación',
            errors
        });
    }

    // Errores de duplicación de MongoDB
    if (err.code === 11000) {
        return res.status(400).json({
            success: false,
            message: 'Error de duplicación',
            error: 'Ya existe un registro con estos datos'
        });
    }

    // Errores de JWT
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Token inválido',
            error: 'No autorizado'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token expirado',
            error: 'Sesión expirada, por favor vuelva a iniciar sesión'
        });
    }

    // Errores de Cast de MongoDB
    if (err.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: 'ID inválido',
            error: 'El ID proporcionado no es válido'
        });
    }

    // Errores de archivo
    if (err.name === 'MulterError') {
        return res.status(400).json({
            success: false,
            message: 'Error al subir archivo',
            error: err.message
        });
    }

    // Errores de Stripe
    if (err.type === 'StripeCardError') {
        return res.status(400).json({
            success: false,
            message: 'Error de tarjeta',
            error: err.message
        });
    }

    if (err.type === 'StripeInvalidRequestError') {
        return res.status(400).json({
            success: false,
            message: 'Error en la solicitud de Stripe',
            error: err.message
        });
    }

    // Errores de PayPal
    if (err.name === 'PayPalError') {
        return res.status(400).json({
            success: false,
            message: 'Error de PayPal',
            error: err.message
        });
    }

    // Error por defecto
    return res.status(statusCode).json({
        success: false,
        message: message,
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
}; 