const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const { JWT_SECRET } = require('../config/constants');

let io;

const initializeSocket = (server) => {
    io = socketIO(server, {
        cors: {
            origin: [
                'https://tesipedia.com',
                'https://www.tesipedia.com',
                'http://localhost:5173',
                'http://localhost:3000'
            ],
            methods: ["GET", "POST"],
            allowedHeaders: ["Authorization", "Content-Type"],
            credentials: true
        },
        transports: ['websocket', 'polling'],
        allowEIO3: true,
        pingTimeout: 60000,
        pingInterval: 25000
    });

    // Middleware de autenticación
    io.use((socket, next) => {
        console.log('🔍 Socket auth attempt with data:', {
            userId: socket.handshake.query.userId,
            isPublic: socket.handshake.query.isPublic,
            hasToken: !!socket.handshake.auth?.token,
            query: socket.handshake.query
        });

        const { isPublic } = socket.handshake.query;

        // Si es chat público, permitir sin token
        if (isPublic === 'true') {
            console.log('✅ Chat público permitido sin token');
            return next();
        }

        // Para chats privados, verificar token
        const token = socket.handshake.auth?.token;
        if (!token) {
            console.log('❌ Token faltante para chat privado');
            return next(new Error('Authentication token missing'));
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.user = decoded;
            console.log('✅ Usuario autenticado:', {
                userId: decoded.userId,
                role: decoded.role,
                socketId: socket.id
            });
            next();
        } catch (err) {
            console.log('❌ Error de verificación de token:', err.message);
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log('🟢 Cliente conectado:', socket.id);
        const { userId, isPublic } = socket.handshake.query;

        // Unirse a sala pública o privada según corresponda
        const room = isPublic === 'true' ? 'public' : userId;
        socket.join(room);
        console.log(`👥 Usuario unido a sala: ${room}`);

        socket.on('message', async (data) => {
            try {
                const { text, receiver, isPublic } = data;
                console.log('📨 Nuevo mensaje recibido:', { text, receiver, isPublic });

                const messageData = {
                    sender: userId,
                    text,
                    isPublic: isPublic === 'true',
                    ...(receiver && { receiver }),
                };

                const message = new Message(messageData);
                await message.save();
                console.log('✅ Mensaje guardado en DB');

                // Emitir mensaje según sea público o privado
                if (isPublic === 'true') {
                    // Emitir a todos en la sala 'public' EXCEPTO al remitente original
                    socket.to('public').emit('message', message);
                    console.log('📢 Mensaje emitido a sala pública (excluyendo remitente)');
                } else {
                    // Para mensajes privados, sí emitir a ambos (incluyendo el remitente)
                    io.to(userId).emit('message', message);
                    io.to(receiver).emit('message', message);
                    console.log('📢 Mensaje emitido a usuarios privados:', userId, receiver);
                }
            } catch (error) {
                console.error('❌ Error al procesar mensaje:', error);
                socket.emit('error', { message: 'Error al enviar mensaje' });
            }
        });

        socket.on('disconnect', () => {
            console.log('🔴 Cliente desconectado:', socket.id);
            socket.leave(room);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};

module.exports = {
    initializeSocket,
    getIO
}; 