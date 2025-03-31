import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    register,
    login,
    logout,
    getProfile,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
    googleAuth,
    googleCallback
} from '../controllers/authController.js';


const router = express.Router();

// Rutas públicas
router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/logout', logout);

// Rutas de Google OAuth
router.get('/google', googleAuth);
router.get('/google/callback', googleCallback);

// Rutas protegidas
router.use(protect);
router.get('/profile', getProfile);
router.put('/profile-update', updateProfile);
router.put('/change-password', changePassword);

export default router; 