import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    createStripeSession,
    getPayments,
    getPaymentById,
    updatePayment,
    deletePayment,
    getMyPayments,
    handlePaymentSuccess,
    handlePaymentFailure,
    handlePaymentCancel,
    getPaymentHistory,
    getPaymentStats,
    refundPayment,
    getRefundStatus
} from '../controllers/paymentController.js';

const router = express.Router();

// Rutas de callback de pago
router.get('/success', handlePaymentSuccess);
router.get('/failure', handlePaymentFailure);
router.get('/cancel', handlePaymentCancel);

// Protected routes
router.use(protect);
router.post('/create-session', createStripeSession);
router.get('/my-payments', getMyPayments);
router.get('/history', getPaymentHistory);
router.get('/stats', getPaymentStats);
router.post('/:id/refund', refundPayment);
router.get('/:id/refund-status', getRefundStatus);

// Admin routes
router.use(adminOnly);
router.get('/', getPayments);
router.get('/:id', getPaymentById);
router.put('/:id', updatePayment);
router.delete('/:id', deletePayment);

export default router; 