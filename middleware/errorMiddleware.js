// Middleware para errores 404 (not found)
export const notFound = (req, res, next) => {
    const error = new Error(`No se encontró - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

// Middleware para manejo general de errores
export const errorHandler = (err, req, res, next) => {
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    let message = err.message;

    // Si es un error de mongoose para ID no válida
    if (err.name === 'CastError' && err.kind === 'ObjectId') {
        statusCode = 400;
        message = 'ID no válido';
    }

    // Si es error de validación de Mongoose
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = Object.values(err.errors).map(val => val.message).join(', ');
    }

    // Si es un error de JWT
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Token inválido';
    }

    // Si el token expiró
    if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expirado, inicia sesión nuevamente';
    }

    // Registro detallado del error
    console.error('Error detectado:');
    console.error('Mensaje:', err.message);
    console.error('Stack:', err.stack);
    console.error('Status code:', statusCode);
    console.error('URL:', req.originalUrl);
    console.error('Método:', req.method);

    // Respuesta al cliente
    res.status(statusCode).json({
        message,
        stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
        details: {
            endpoint: req.originalUrl,
            method: req.method,
            timestamp: new Date().toISOString()
        }
    });
}; 