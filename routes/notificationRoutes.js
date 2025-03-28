import express from 'express';
import { protect, admin } from '../middleware/auth.js';
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
router.use(admin);
router.get('/admin', getAdminNotifications);
router.post('/admin/:id/read', markNotificationAsRead);

export default router; 