import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  gaDashboard,
  gaOverview,
  gaRealtime,
  gaTopPages,
  gaEvents,
  gaChannels,
  gaCountries,
  gaTimeline,
  gaDevices,
} from '../controllers/gaController.js';

const router = express.Router();

// All GA routes require admin auth
router.use(protect);
router.use(adminOnly);

// All-in-one dashboard endpoint (recommended — fewer requests)
router.get('/dashboard', gaDashboard);

// Individual endpoints
router.get('/overview', gaOverview);
router.get('/realtime', gaRealtime);
router.get('/pages', gaTopPages);
router.get('/events', gaEvents);
router.get('/channels', gaChannels);
router.get('/countries', gaCountries);
router.get('/timeline', gaTimeline);
router.get('/devices', gaDevices);

export default router;
