import asyncHandler from 'express-async-handler';
import Notification from '../models/Notification.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// 🔔 Obtener notificaciones del SUPER ADMIN
export const getAdminNotifications = asyncHandler(async (req, res) => {
  if (req.user._id.toString() !== SUPER_ADMIN_ID) {
    res.status(403);
    throw new Error('Acceso denegado');
  }

  const notifications = await Notification.find({ user: SUPER_ADMIN_ID })
    .sort({ createdAt: -1 })
    .limit(100);

  res.json(notifications);
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

  res.json({ message: 'Notificación marcada como leída' });
});

// 📬 Obtener notificaciones del usuario autenticado
export const getMyNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 });

  res.json(notifications);
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

  res.json({ message: 'Notificación marcada como leída' });
});

// 📦 Marcar todas como leídas para el usuario autenticado
export const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user: req.user._id, isRead: false },
    { $set: { isRead: true } }
  );

  res.json({ message: 'Todas las notificaciones marcadas como leídas' });
});

// ❌ Eliminar una notificación del usuario autenticado
export const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification || !notification.user?.equals(req.user._id)) {
    res.status(404);
    throw new Error('Notificación no encontrada o acceso no autorizado');
  }

  await notification.deleteOne();
  res.json({ message: 'Notificación eliminada' });
});
