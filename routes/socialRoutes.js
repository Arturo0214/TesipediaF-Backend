import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { getSocialMetrics } from '../controllers/socialController.js';

const router = express.Router();

router.get('/metrics', protect, adminOnly, getSocialMetrics);

export default router;
