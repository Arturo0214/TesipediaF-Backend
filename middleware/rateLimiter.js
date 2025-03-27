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

export const quoteLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: {
      message: 'Has creado muchas cotizaciones recientemente. Intenta más tarde.',
    },
});

// 🔁 3. Limita peticiones generales desde una IP (opcional global)
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100,
  message: {
    message: '⚠️ Demasiadas solicitudes. Reduce la velocidad.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 📤 Subida de archivos
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: {
    message: '📤 Límite de subidas alcanzado. Espera antes de intentar otra vez.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 💳 Intentos de pago
export const paymentLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: {
    message: '💳 Demasiados intentos de pago. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🌍 Visitas anónimas (IP)
export const visitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 100,
  message: {
    message: '🌐 Límite de visitas alcanzado desde esta IP. Intenta después.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const orderLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutos
  max: 5, // Máximo 5 pedidos por usuario/IP en ese periodo
  message: {
    message: '📦 Has alcanzado el límite de creación de pedidos. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});