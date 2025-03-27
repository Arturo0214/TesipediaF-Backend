import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import http from 'http';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import setCookie from './middleware/setCookie.js'
import connectDB from './config/db.js';

import { Server } from 'socket.io';
import { chatSocket } from './sockets/chatSocket.js';
import { generalLimiter } from './middleware/rateLimiter.js';

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
// import paymentRoutes from './routes/paymentRoutes.js';

// Middlewares
import { notFound, errorHandler } from './middleware/errorHandler.js';

// Configurar variables de entorno
dotenv.config();

// Conectar a la base de datos
connectDB();

// Inicializar la app
const app = express();

// Middlewares globales
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(setCookie);
app.use(morgan('dev'));
app.use(helmet());
app.use(generalLimiter);

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
// app.use('/xxpayments', paymentRoutes);

// Middlewares de error
app.use(notFound);
app.use(errorHandler);

// Puerto
const PORT = process.env.PORT || 8000;

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    credentials: true,
  },
});
chatSocket(io);