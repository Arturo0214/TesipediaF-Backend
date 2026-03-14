import express from 'express';
import {
    getAuthUrlEndpoint,
    handleCallback,
    getConnectionStatus,
    getCalendarEvents,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    syncProjectToCalendar
} from '../controllers/googleCalendarController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// OAuth endpoints
router.get('/auth-url', protect, admin, getAuthUrlEndpoint);
router.get('/callback', handleCallback);

// Status and events
router.get('/connection-status', protect, admin, getConnectionStatus);
router.get('/events', protect, admin, getCalendarEvents);

// Event management
router.post('/events', protect, admin, createCalendarEvent);
router.put('/events/:eventId', protect, admin, updateCalendarEvent);
router.delete('/events/:eventId', protect, admin, deleteCalendarEvent);

// Project sync
router.post('/sync-project/:projectId', protect, admin, syncProjectToCalendar);

export default router;
