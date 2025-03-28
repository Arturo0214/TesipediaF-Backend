import asyncHandler from 'express-async-handler';
import Notification from '../models/Notification.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// 🔔 Obtener notificaciones del SUPER ADMIN con paginación
export const getAdminNotifications = asyncHandler(async (req, res) => {
  if (req.user._id.toString() !== SUPER_ADMIN_ID) {
    res.status(403);
    throw new Error('Acceso denegado');
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const [notifications, total] = await Promise.all([
    Notification.find({ user: SUPER_ADMIN_ID })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email'),
    Notification.countDocuments({ user: SUPER_ADMIN_ID })
  ]);

  res.json({
    notifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// ✅ Marcar una notificación del SUPER ADMIN como leída
export const markNotificationAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    res.status(404);
    throw new Error('Notificación no encontrada');
  }

  if (notification.user?.toString() !== SUPER_ADMIN_ID) {
    res.status(403);
    throw new Error('No autorizado');
  }

  notification.isRead = true;
  await notification.save();

  // Emitir evento de socket si está disponible
  if (req.app.get('io')) {
    req.app.get('io').to(`notifications:${SUPER_ADMIN_ID}`).emit('notificationRead', {
      notificationId: notification._id,
      isRead: true
    });
  }

  res.json({ message: 'Notificación marcada como leída' });
});

// 📬 Obtener notificaciones del usuario autenticado con paginación y filtros
export const getMyNotifications = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const isRead = req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined;

  const query = { user: req.user._id };
  if (isRead !== undefined) {
    query.isRead = isRead;
  }

  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email'),
    Notification.countDocuments(query)
  ]);

  res.json({
    notifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// ✅ Marcar una notificación del usuario autenticado como leída
export const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification || !notification.user?.equals(req.user._id)) {
    res.status(404);
    throw new Error('Notificación no encontrada o acceso no autorizado');
  }

  notification.isRead = true;
  await notification.save();

  // Emitir evento de socket si está disponible
  if (req.app.get('io')) {
    req.app.get('io').to(`notifications:${req.user._id}`).emit('notificationRead', {
      notificationId: notification._id,
      isRead: true
    });
  }

  res.json({ message: 'Notificación marcada como leída' });
});

// 📦 Marcar todas como leídas para el usuario autenticado
export const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { user: req.user._id, isRead: false },
    { $set: { isRead: true } }
  );

  // Emitir evento de socket si está disponible
  if (req.app.get('io')) {
    req.app.get('io').to(`notifications:${req.user._id}`).emit('allNotificationsRead');
  }

  res.json({
    message: 'Todas las notificaciones marcadas como leídas',
    modifiedCount: result.modifiedCount
  });
});

// ❌ Eliminar una notificación del usuario autenticado
export const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification || !notification.user?.equals(req.user._id)) {
    res.status(404);
    throw new Error('Notificación no encontrada o acceso no autorizado');
  }

  await notification.deleteOne();

  // Emitir evento de socket si está disponible
  if (req.app.get('io')) {
    req.app.get('io').to(`notifications:${req.user._id}`).emit('notificationDeleted', {
      notificationId: notification._id
    });
  }

  res.json({ message: 'Notificación eliminada' });
});

// 📊 Obtener estadísticas de notificaciones
export const getNotificationStats = asyncHandler(async (req, res) => {
  const stats = await Notification.aggregate([
    { $match: { user: req.user._id } },
    {
      $group: {
        _id: '$isRead',
        count: { $sum: 1 }
      }
    }
  ]);

  const total = stats.reduce((acc, curr) => acc + curr.count, 0);
  const unread = stats.find(s => s._id === false)?.count || 0;

  res.json({
    total,
    unread,
    read: total - unread
  });
});
