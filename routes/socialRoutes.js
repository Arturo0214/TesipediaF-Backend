import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { getSocialMetrics, getSocialPosts, getSocialInsights, publishPost } from '../controllers/socialController.js';

const router = express.Router();

router.get('/metrics', protect, adminOnly, getSocialMetrics);
router.get('/insights/:platform', protect, adminOnly, getSocialInsights);
router.get('/posts/:platform', protect, adminOnly, getSocialPosts);
router.post('/publish', protect, adminOnly, publishPost);

export default router;
