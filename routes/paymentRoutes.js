import { paymentLimiter } from '../middleware/rateLimiter.js';
router.post('/pay', protect, paymentLimiter, processPayment);