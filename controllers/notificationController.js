import Notification from '../models/Notification.js';
import asyncHandler from 'express-async-handler';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// @desc    Crear una nueva notificación
// @route   POST /api/notifications
// @access  Private
export const createNotification = asyncHandler(async (req, res) => {
  const { user, type, message, priority, isRead } = req.body;

  const notification = await Notification.create({
    user,
    type,
    message,
    priority,
    isRead: isRead || false
  });

  res.status(201).json(notification);
});

// @desc    Obtener notificaciones del usuario
// @route   GET /api/notifications
// @access  Private
export const getMyNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 });

  res.json(notifications);
});

// @desc    Obtener todas las notificaciones (admin)
// @route   GET /api/notifications/admin
// @access  Private/Admin
export const getAdminNotifications = asyncHandler(async (req, res) => {
  if (!req.user.isAdmin) {
    res.status(403);
    throw new Error('No autorizado');
  }

  const notifications = await Notification.find()
    .populate('user', 'name email')
    .sort({ createdAt: -1 });

  res.json(notifications);
});

// @desc    Marcar notificación como leída
// @route   PATCH /api/notifications/:id/read
// @access  Private
export const markNotificationAsRead = asyncHandler(async (req, res) => {
  console.log('Marking notification as read:', req.params.id);
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    res.status(404);
    throw new Error('Notificación no encontrada');
  }

  // Verificar propiedad
  if (notification.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    console.log('Unauthorized attempt to mark read:', req.user._id);
    res.status(403);
    throw new Error('No autorizado');
  }

  const updatedNotification = await Notification.findByIdAndUpdate(
    req.params.id,
    { isRead: true },
    { new: true }
  );

  console.log('Notification updated:', updatedNotification);
  res.json(updatedNotification);
});

// @desc    Marcar todas las notificaciones como leídas
// @route   PATCH /api/notifications/mark-all-read
// @access  Private
export const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user: req.user._id, isRead: false },
    { isRead: true }
  );

  res.json({ message: 'Todas las notificaciones han sido marcadas como leídas' });
});

// @desc    Marcar notificaciones de un tipo específico como leídas
// @route   POST /api/notifications/mark-type-read
// @access  Private
export const markNotificationsByType = asyncHandler(async (req, res) => {
  const { type } = req.body;

  if (!type) {
    res.status(400);
    throw new Error('Tipo de notificación requerido');
  }

  // Handle singular vs plural mapping if necessary, or assume frontend sends correct 'type' stored in DB
  // DB types: 'cotizacion', 'mensaje', 'visita', etc.
  // Frontend sends: 'cotizacion', 'mensaje', etc.

  // Si el tipo es 'mensajes', convertir a 'mensaje' (singular) si es necesario.
  // Pero lo ideal es que el frontend envíe el tipo correcto.
  // Vamos a asumir que el frontend envía el tipo correcto tal cual está en la DB.

  const query = {
    user: req.user._id,
    isRead: false,
    type: type // Exact match
  };

  const result = await Notification.updateMany(query, { isRead: true });

  console.log(`Marked ${result.nModified || result.modifiedCount} notifications of type ${type} as read.`);

  res.json({
    message: `Notificaciones de tipo ${type} marcadas como leídas`,
    count: result.nModified || result.modifiedCount,
    type
  });
});

// @desc    Eliminar una notificación
// @route   DELETE /api/notifications/:id
// @access  Private
export const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    res.status(404);
    throw new Error('Notificación no encontrada');
  }

  if (notification.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    res.status(403);
    throw new Error('No autorizado');
  }

  await notification.deleteOne();
  res.json({ message: 'Notificación eliminada' });
});

// @desc    Obtener estadísticas de notificaciones
// @route   GET /api/notifications/stats
// @access  Private
export const getNotificationStats = asyncHandler(async (req, res) => {
  const total = await Notification.countDocuments({ user: req.user._id });
  const unread = await Notification.countDocuments({ user: req.user._id, isRead: false });

  res.json({
    total,
    unread,
    read: total - unread
  });
});
