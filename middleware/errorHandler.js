export const notFound = (req, res, next) => {
    const error = new Error(`🛑 Ruta no encontrada: ${req.originalUrl}`);
    res.status(404);
    next(error);
};

export const errorHandler = (err, req, res, next) => {
    const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  
    res.status(statusCode).json({
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? '🥷🏼' : err.stack,
    });
};
  