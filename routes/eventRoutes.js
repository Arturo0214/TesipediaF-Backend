import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  trackEvent,
  getEventFeed,
  getEventStats,
  getRealtimeData,
  getVisitors,
  getVisitorJourney,
} from '../controllers/eventController.js';

const router = express.Router();

// Public — fire-and-forget event tracking (no auth needed)
router.post('/track', trackEvent);

// Admin only
router.use(protect);
router.use(adminOnly);

router.get('/feed', getEventFeed);
router.get('/stats', getEventStats);
router.get('/realtime', getRealtimeData);
router.get('/visitors', getVisitors);
router.get('/visitor/:visitorId', getVisitorJourney);

export default router;
