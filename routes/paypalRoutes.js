import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import {
    createPayPalOrder,
    capturePayPalPayment,
    refundPayPalPayment,
    getPayPalRefundStatus
} from '../controllers/paypalController.js';

const router = express.Router();

// Rutas públicas (webhooks)
router.post('/capture', capturePayPalPayment);

// Rutas protegidas
router.use(protect);
router.post('/create-order', createPayPalOrder);

// Rutas de admin
router.use(admin);
router.post('/:id/refund', refundPayPalPayment);
router.get('/:id/refund-status', getPayPalRefundStatus);

export default router; 