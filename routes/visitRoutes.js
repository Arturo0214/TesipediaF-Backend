import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import {
    trackVisit,
    getVisitStats,
    getVisitHistory,
    getVisitById,
    deleteVisit,
    getVisitAnalytics
} from '../controllers/visitController.js';

const router = express.Router();

// Public routes
router.post('/track', trackVisit);

// Protected routes (admin only)
router.use(protect);
router.use(admin);

// Visit management
router.get('/stats', getVisitStats);
router.get('/history', getVisitHistory);
router.get('/analytics', getVisitAnalytics);
router.get('/:id', getVisitById);
router.delete('/:id', deleteVisit);

export default router; 