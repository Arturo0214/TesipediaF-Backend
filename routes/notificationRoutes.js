import express from 'express';
import {
  getAdminNotifications,
  getMyNotifications,
  markNotificationAsRead,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from '../controllers/notificationController.js';

import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

// 🛡️ Rutas protegidas
router.use(protect);

// 🔔 Notificaciones para el usuario autenticado
router.get('/', getMyNotifications);
router.patch('/:id/read', markAsRead);
router.patch('/read-all', markAllAsRead);
router.delete('/:id', deleteNotification);

// 🔔 Notificaciones del administrador (requiere ser el SUPER_ADMIN_ID)
router.get('/admin/all', adminOnly, getAdminNotifications);
router.patch('/admin/:id/read', adminOnly, markNotificationAsRead);

export default router;
