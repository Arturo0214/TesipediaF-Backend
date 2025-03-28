import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

export const configureSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_URL,
            credentials: true,
        },
        pingTimeout: 60000, // 1 minute
        pingInterval: 25000, // 25 seconds
        connectTimeout: 10000, // 10 seconds
    });

    // Middleware for authentication
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication error'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;
            next();
        } catch (error) {
            next(new Error('Authentication error'));
        }
    });

    // Connection handling
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.user._id}`);

        // Join user's personal room
        socket.join(`user:${socket.user._id}`);

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.user._id}`);
        });

        // Handle errors
        socket.on('error', (error) => {
            console.error(`Socket error for user ${socket.user._id}:`, error);
        });

        // Handle reconnection
        socket.on('reconnect', (attemptNumber) => {
            console.log(`User ${socket.user._id} reconnected after ${attemptNumber} attempts`);
        });

        // Handle reconnection attempts
        socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`Reconnection attempt ${attemptNumber} for user ${socket.user._id}`);
        });

        // Handle reconnection error
        socket.on('reconnect_error', (error) => {
            console.error(`Reconnection error for user ${socket.user._id}:`, error);
        });

        // Handle reconnection failed
        socket.on('reconnect_failed', () => {
            console.log(`Reconnection failed for user ${socket.user._id}`);
        });
    });

    // Global error handling
    io.on('error', (error) => {
        console.error('Socket.IO Server Error:', error);
    });

    return io;
}; 