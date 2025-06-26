import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import http from 'http';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import setCookie from './middleware/setCookie.js'
import connectDB from './config/db.js';
import { validateRequest } from './middleware/validateRequest.js';
import { configureSocket } from './sockets/socketConfig.js';
import { chatSocket } from './sockets/chatSocket.js';
import { notificationSocket } from './sockets/notificationSocket.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { globalErrorHandler } from './middleware/asyncErrors.js';

// Rutas (a implementar)
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from "./routes/adminRoutes.js";
import quoteRoutes from './routes/quoteRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import visitRoutes from './routes/visitRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import paypalRoutes from './routes/paypalRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import projectRoutes from './routes/projectRoutes.js';

// Middlewares
import { notFound, errorHandler } from './middleware/errorMiddleware.js';

// Configurar variables de entorno
dotenv.config();

// Conectar a la base de datos
connectDB();

// Inicializar la app
const app = express();

// Middlewares globales
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(cookieParser());
app.use(setCookie);

// Configuración de CORS
const allowedOrigins = [
  'http://localhost:5173',
  'https://tesipedia.com',
  'https://www.tesipedia.com'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir solicitudes sin origen (como las de Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'La política CORS para este sitio no permite acceso desde el origen especificado.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Middleware para headers CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Agregar trust proxy para rate limiter
app.set('trust proxy', 1);

app.use(generalLimiter);
app.use(validateRequest);

// Rutas base
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/admin', adminRoutes);
app.use('/quotes', quoteRoutes);
app.use('/orders', orderRoutes);
app.use('/visits', visitRoutes);
app.use('/upload', uploadRoutes);
app.use('/chat', chatRoutes);
app.use('/notifications', notificationRoutes);
app.use('/payments', paymentRoutes);
app.use('/paypal', paypalRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api/projects', projectRoutes);

// Middlewares de error
app.use(notFound);
app.use(errorHandler);

// 🔢 Puerto
const PORT = process.env.PORT || 8000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with configuration
const io = configureSocket(server);

// Make io accessible to routes
app.set('io', io);

// Initialize socket functionality
chatSocket(io);
notificationSocket(io);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});