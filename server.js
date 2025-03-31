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
import webhookRoutes from './routes/webhookRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import paypalRoutes from './routes/paypalRoutes.js';

// Middlewares
import { notFound } from './middleware/errorHandler.js';

// Configurar variables de entorno
dotenv.config();

// Conectar a la base de datos
connectDB();

// Inicializar la app
const app = express();

// Middlewares globales
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de CORS
app.use(cors({
  origin: process.env.CLIENT_URL, // Asegúrate de que esta variable esté configurada correctamente
  credentials: true, // Permitir cookies
}));

app.use(cookieParser());
app.use(setCookie);
app.use(morgan('dev'));
app.use(helmet());
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
app.use('/webhook', webhookRoutes);
app.use('/chat', chatRoutes);
app.use('/notifications', notificationRoutes);
app.use('/payments', paymentRoutes);
app.use('/paypal', paypalRoutes);

// Middlewares de error
app.use(notFound);
app.use(globalErrorHandler);

// Puerto
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