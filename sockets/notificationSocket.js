import Notification from '../models/Notification.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

export const notificationSocket = (io) => {
    io.on('connection', (socket) => {
        console.log('🔔 Usuario conectado a notificaciones:', socket.id);

        // Auto-join notification room on connect if user is authenticated
        if (socket.user?._id) {
            const userId = socket.user._id.toString();
            socket.join(`notifications:${userId}`);
            console.log(`🧩 Usuario ${userId} auto-unido a sala de notificaciones`);
        }

        // 👉 Unirse a la sala de notificaciones del usuario (manual fallback)
        socket.on('joinNotifications', () => {
            const userId = socket.user._id.toString();
            socket.join(`notifications:${userId}`);
            console.log(`🧩 Usuario ${userId} se unió a sus notificaciones`);
        });

        // 👉 Marcar notificación como leída
        socket.on('markNotificationAsRead', async (notificationId) => {
            try {
                const notification = await Notification.findById(notificationId);

                if (!notification) {
                    socket.emit('error', { message: 'Notificación no encontrada' });
                    return;
                }

                // Verificar autorización
                if (notification.user.toString() !== socket.user._id.toString() &&
                    notification.user.toString() !== SUPER_ADMIN_ID) {
                    socket.emit('error', { message: 'No autorizado' });
                    return;
                }

                notification.isRead = true;
                await notification.save();

                // Emitir actualización a la sala del usuario
                io.to(`notifications:${notification.user}`).emit('notificationRead', {
                    notificationId,
                    isRead: true
                });

                console.log(`📖 Notificación ${notificationId} marcada como leída`);
            } catch (error) {
                console.error('Error al marcar notificación como leída:', error);
                socket.emit('error', { message: 'Error al marcar notificación como leída' });
            }
        });

        // 👉 Marcar todas las notificaciones como leídas
        socket.on('markAllNotificationsAsRead', async () => {
            try {
                const userId = socket.user._id.toString();

                await Notification.updateMany(
                    { user: userId, isRead: false },
                    { $set: { isRead: true } }
                );

                // Emitir actualización a la sala del usuario
                io.to(`notifications:${userId}`).emit('allNotificationsRead');

                console.log(`📖 Todas las notificaciones de ${userId} marcadas como leídas`);
            } catch (error) {
                console.error('Error al marcar todas las notificaciones como leídas:', error);
                socket.emit('error', { message: 'Error al marcar notificaciones como leídas' });
            }
        });

        // 👉 Eliminar notificación
        socket.on('deleteNotification', async (notificationId) => {
            try {
                const notification = await Notification.findById(notificationId);

                if (!notification) {
                    socket.emit('error', { message: 'Notificación no encontrada' });
                    return;
                }

                // Verificar autorización
                if (notification.user.toString() !== socket.user._id.toString()) {
                    socket.emit('error', { message: 'No autorizado' });
                    return;
                }

                await notification.deleteOne();

                // Emitir actualización a la sala del usuario
                io.to(`notifications:${notification.user}`).emit('notificationDeleted', {
                    notificationId
                });

                console.log(`🗑️ Notificación ${notificationId} eliminada`);
            } catch (error) {
                console.error('Error al eliminar notificación:', error);
                socket.emit('error', { message: 'Error al eliminar notificación' });
            }
        });

        // 👉 Desconexión
        socket.on('disconnect', () => {
            console.log('🔴 Usuario desconectado de notificaciones:', socket.id);
        });
    });
}; 