import express from 'express';
import {
  registerUser,
  loginUser,
  requestPasswordReset,
  resetPassword,
} from '../controllers/authController.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Limitar acceso a rutas sensibles
router.post('/login', authLimiter, loginUser);
router.post('/register', authLimiter, registerUser);
router.post('/forgot-password', authLimiter, requestPasswordReset);
router.post('/reset-password/:token', authLimiter, resetPassword);

export default router;
