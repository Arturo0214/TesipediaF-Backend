import Notification from '../models/Notification.js';

/**
 * Create a notification and emit it via socket to the target user.
 * @param {Object} app - Express app instance (to access io via app.get('io'))
 * @param {Object} data - Notification data { user, type, message, data, link, priority }
 * @returns {Promise<Object>} The created notification document
 */
const createNotification = async (app, data) => {
  const notification = await Notification.create({
    user: data.user,
    type: data.type,
    message: data.message,
    data: data.data || {},
    link: data.link || null,
    priority: data.priority || 'low',
    isRead: false,
  });

  // Emit via socket so the frontend receives it in real-time
  try {
    const io = app?.get?.('io');
    if (io && data.user) {
      io.to(`notifications:${data.user}`).emit('notification:new', notification);
      console.log(`🔔 Notificación emitida por socket a ${data.user}:`, notification.type);
    }
  } catch (err) {
    console.error('Error al emitir notificación por socket:', err);
  }

  return notification;
};

export default createNotification;
