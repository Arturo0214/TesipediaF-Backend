import express from 'express';
import { trackVisit } from '../controllers/visitController.js';
import { visitLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/track', visitLimiter, trackVisit);

export default router;