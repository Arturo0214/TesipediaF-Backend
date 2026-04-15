import express from 'express';
import {
    getAuthUrlEndpoint,
    handleCallback,
    getConnectionStatus,
    getCalendarEvents,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    syncProjectToCalendar,
    getConnectedAdmins,
    toggleAutoSync,
    disconnectAdmin,
    scheduleCall,
    bulkSync,
} from '../controllers/googleCalendarController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// OAuth endpoints
router.get('/auth-url', protect, admin, getAuthUrlEndpoint);
router.get('/callback', handleCallback); // público (redirect de Google)

// Multi-admin management
router.get('/admins', protect, admin, getConnectedAdmins);
router.get('/status', protect, admin, getConnectionStatus);
router.post('/toggle-autosync', protect, admin, toggleAutoSync);
router.post('/disconnect', protect, admin, disconnectAdmin);

// Legacy compat
router.get('/connection-status', protect, admin, getConnectionStatus);

// Events
router.get('/events', protect, admin, getCalendarEvents);
router.post('/events', protect, admin, createCalendarEvent);
router.put('/events/:eventId', protect, admin, updateCalendarEvent);
router.delete('/events/:eventId', protect, admin, deleteCalendarEvent);

// Project sync
router.post('/sync-project/:projectId', protect, admin, syncProjectToCalendar);

// Bulk sync (todos los proyectos + pagos)
router.post('/bulk-sync', protect, admin, bulkSync);

// Agendar llamada (desde WhatsApp)
router.post('/schedule-call', protect, admin, scheduleCall);

export default router;
