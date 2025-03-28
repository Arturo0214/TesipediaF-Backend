import express from 'express';
import { protect } from '../middleware/auth.js';
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

// Rutas de Google OAuth
router.get('/google', googleAuth);
router.get('/google/callback', googleCallback);

// Rutas protegidas
router.use(protect);
router.post('/logout', logout);
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.put('/change-password', changePassword);

export default router; 