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
            console.log('🔍 Socket auth attempt with data:', {
                userId: socket.handshake.auth.userId,
                isPublic: socket.handshake.auth.isPublic,
                hasToken: !!socket.handshake.auth.token,
                query: socket.handshake.query
            });

            const { userId, isPublic } = socket.handshake.auth;

            // Si es un usuario público, permitir la conexión con el ID público
            if (isPublic && userId) {
                console.log('✅ Usuario público autenticado:', {
                    userId,
                    socketId: socket.id,
                    query: socket.handshake.query
                });
                socket.user = {
                    _id: userId,
                    name: 'Usuario Anónimo',
                    isPublic: true
                };
                // Unir al usuario a su sala pública
                socket.join(`public:${userId}`);
                return next();
            }

            // Para usuarios autenticados, verificar el token
            const token = socket.handshake.auth.token;
            if (!token) {
                console.error('❌ Token no proporcionado para socket');
                return next(new Error('Token no proporcionado'));
            }

            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                console.log('✅ Usuario autenticado:', {
                    userId: decoded.id,
                    role: decoded.role,
                    socketId: socket.id
                });
                socket.user = {
                    _id: decoded.id,
                    role: decoded.role,
                    isPublic: false
                };
                // Unir al usuario a su sala personal
                socket.join(`user:${decoded.id}`);
                next();
            } catch (tokenError) {
                console.error('❌ Error verificando token:', tokenError.message);
                next(new Error('Token inválido'));
            }
        } catch (error) {
            console.error('❌ Socket authentication error:', error);
            next(new Error('Error de autenticación'));
        }
    });

    // Connection handling
    io.on('connection', (socket) => {
        const userType = socket.user.isPublic ? 'público' : 'autenticado';
        console.log(`Usuario ${userType} conectado: ${socket.user._id}`);

        // Handle public chat join
        socket.on('joinPublicChat', (publicId) => {
            if (socket.user.isPublic && socket.user._id === publicId) {
                socket.join(`public:${publicId}`);
                console.log(`Usuario público ${publicId} unido a su sala`);
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`Usuario ${userType} desconectado: ${socket.user._id}`);
            // Limpiar las salas al desconectar
            if (socket.user.isPublic) {
                socket.leave(`public:${socket.user._id}`);
            } else {
                socket.leave(`user:${socket.user._id}`);
            }
        });

        // Handle errors
        socket.on('error', (error) => {
            console.error(`Error de socket para usuario ${socket.user._id}:`, error);
        });

        // Handle reconnection
        socket.on('reconnect', (attemptNumber) => {
            console.log(`Usuario ${socket.user._id} reconectado después de ${attemptNumber} intentos`);
            // Volver a unir al usuario a su sala correspondiente
            if (socket.user.isPublic) {
                socket.join(`public:${socket.user._id}`);
            } else {
                socket.join(`user:${socket.user._id}`);
            }
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