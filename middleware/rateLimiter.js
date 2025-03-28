import rateLimit from 'express-rate-limit';

// ❗️ Rate limiter para rutas sensibles (auth, reset, etc.)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Máximo 10 peticiones por IP
  message: {
    message: 'Demasiados intentos. Por favor intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔄 Recuperación de contraseña
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // 3 intentos por hora
  message: {
    message: 'Demasiados intentos de recuperación de contraseña. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 📝 Cotizaciones
export const quoteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 5, // 5 cotizaciones
  message: {
    message: 'Has creado muchas cotizaciones recientemente. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔁 Limita peticiones generales desde una IP
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // 100 peticiones por minuto
  message: {
    message: '⚠️ Demasiadas solicitudes. Reduce la velocidad.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 📤 Subida de archivos
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 10, // 10 subidas
  message: {
    message: '📤 Límite de subidas alcanzado. Espera antes de intentar otra vez.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 💳 Intentos de pago
export const paymentLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutos
  max: 5, // 5 intentos
  message: {
    message: '💳 Demasiados intentos de pago. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🌍 Visitas anónimas (IP)
export const visitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 100, // 100 visitas por hora
  message: {
    message: '🌐 Límite de visitas alcanzado desde esta IP. Intenta después.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 📦 Pedidos
export const orderLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutos
  max: 5, // 5 pedidos
  message: {
    message: '📦 Has alcanzado el límite de creación de pedidos. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔔 Notificaciones
export const notificationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // 30 peticiones
  message: {
    message: '🔔 Demasiadas solicitudes de notificaciones. Reduce la velocidad.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 💬 Chat y mensajes
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 50, // 50 mensajes
  message: {
    message: '💬 Demasiados mensajes. Reduce la velocidad.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔍 Búsquedas
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20, // 20 búsquedas
  message: {
    message: '🔍 Demasiadas búsquedas. Reduce la velocidad.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 📝 Comentarios y reseñas
export const commentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // 10 comentarios
  message: {
    message: '📝 Has alcanzado el límite de comentarios. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 👤 Perfil y configuración
export const profileLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20, // 20 actualizaciones
  message: {
    message: '👤 Demasiadas actualizaciones de perfil. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 📱 Verificación de teléfono/email
export const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // 3 intentos
  message: {
    message: '📱 Demasiados intentos de verificación. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔒 Cambio de contraseña
export const changePasswordLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 horas
  max: 3, // 3 intentos
  message: {
    message: '🔒 Demasiados intentos de cambio de contraseña. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 📊 Reportes y denuncias
export const reportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 horas
  max: 5, // 5 reportes
  message: {
    message: '📊 Has alcanzado el límite de reportes. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});