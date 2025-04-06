import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

export const configureSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_URL || 'http://localhost:5173',
            credentials: true,
        },
        pingTimeout: 60000, // 1 minute
        pingInterval: 25000, // 25 seconds
        connectTimeout: 10000, // 10 seconds
    });

    // Middleware for authentication
    io.use(async (socket, next) => {
        try {
            const { userId, isPublic } = socket.handshake.auth;

            // Si es un usuario público, permitir la conexión con el ID público
            if (isPublic && userId) {
                socket.user = {
                    _id: userId,
                    name: 'Usuario Anónimo',
                    isPublic: true
                };
                return next();
            }

            // Para usuarios autenticados, verificar el token
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Token no proporcionado'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = {
                ...decoded,
                isPublic: false
            };
            next();
        } catch (error) {
            console.error('Socket authentication error:', error);
            next(new Error('Error de autenticación'));
        }
    });

    // Connection handling
    io.on('connection', (socket) => {
        const userType = socket.user.isPublic ? 'público' : 'autenticado';
        console.log(`Usuario ${userType} conectado: ${socket.user._id}`);

        // Join user's personal room
        socket.join(`user:${socket.user._id}`);

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`Usuario ${userType} desconectado: ${socket.user._id}`);
        });

        // Handle errors
        socket.on('error', (error) => {
            console.error(`Error de socket para usuario ${socket.user._id}:`, error);
        });

        // Handle reconnection
        socket.on('reconnect', (attemptNumber) => {
            console.log(`Usuario ${socket.user._id} reconectado después de ${attemptNumber} intentos`);
        });

        // Handle reconnection attempts
        socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`Intento de reconexión ${attemptNumber} para usuario ${socket.user._id}`);
        });

        // Handle reconnection error
        socket.on('reconnect_error', (error) => {
            console.error(`Error de reconexión para usuario ${socket.user._id}:`, error);
        });

        // Handle reconnection failed
        socket.on('reconnect_failed', () => {
            console.log(`Reconexión fallida para usuario ${socket.user._id}`);
        });
    });

    // Global error handling
    io.on('error', (error) => {
        console.error('Socket.IO Server Error:', error);
    });

    return io;
}; 