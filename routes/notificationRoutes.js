import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    getAdminNotifications,
    markNotificationAsRead,
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    getNotificationStats
} from '../controllers/notificationController.js';

const router = express.Router();

// Protected routes
router.use(protect);
router.get('/my-notifications', getMyNotifications);
router.post('/:id/read', markAsRead);
router.post('/mark-all-read', markAllAsRead);
router.delete('/:id', deleteNotification);
router.get('/stats', getNotificationStats);

// Admin routes
router.use(adminOnly);
router.get('/admin', getAdminNotifications);
router.post('/admin/:id/read', markNotificationAsRead);

export default router; 