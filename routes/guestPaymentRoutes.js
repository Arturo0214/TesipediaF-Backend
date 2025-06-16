import express from 'express';
import { adminOnly } from '../middleware/authMiddleware.js';
import {
    createGuestPaymentSession,
    checkGuestPaymentStatus,
    getAllGuestPayments,
    getGuestPaymentById
} from '../controllers/guestPaymentController.js';

const router = express.Router();

// Rutas públicas
router.post('/create-session', createGuestPaymentSession);
router.get('/status/:trackingToken', checkGuestPaymentStatus);

// Rutas de administrador
router.use(adminOnly);
router.get('/', getAllGuestPayments);
router.get('/:id', getGuestPaymentById);

export default router; 