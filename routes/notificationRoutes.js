import express from 'express';
import {
    createNotification,
    getMyNotifications,
    getAdminNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    getNotificationStats,
    markNotificationsByType,
} from '../controllers/notificationController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import Notification from '../models/Notification.js';
import asyncHandler from 'express-async-handler';

const router = express.Router();

// ✅ Todas las rutas están protegidas
router.use(protect);

// 🔔 Crear una nueva notificación
router.post('/', createNotification);

// 🔔 Obtener mis notificaciones
router.get('/', getMyNotifications);

// 🔔 Marcar una notificación como leída
router.patch('/:id/read', markNotificationAsRead);
router.post('/:id/read', markNotificationAsRead);

// 🔔 Marcar todas como leídas
router.patch('/mark-all-read', markAllNotificationsAsRead);
router.post('/mark-all-read', markAllNotificationsAsRead);

// 🔔 Marcar por tipo como leídas
router.post('/mark-type-read', markNotificationsByType);

// 🔔 Eliminar una notificación
router.delete('/:id', deleteNotification);

// 🔔 Obtener estadísticas de notificaciones
router.get('/stats', getNotificationStats);

// 🔔 Obtener notificaciones del admin (solo para SUPER ADMIN)
router.get('/admin', adminOnly, getAdminNotifications);

export default router;
