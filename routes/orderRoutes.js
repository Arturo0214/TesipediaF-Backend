import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import {
    createOrder,
    getOrders,
    getOrderById,
    updateOrder,
    deleteOrder,
    getMyOrders,
    updateOrderStatus,
    uploadOrderFile,
    deleteOrderFile,
    getOrderFiles,
    getOrderHistory,
    getOrderAnalytics
} from '../controllers/orderController.js';

const router = express.Router();

// Protected routes
router.use(protect);
router.post('/', createOrder);
router.get('/my-orders', getMyOrders);
router.get('/:id', getOrderById);
router.put('/:id', updateOrder);
router.delete('/:id', deleteOrder);
router.put('/:id/status', updateOrderStatus);

// File management
router.post('/:id/files', uploadOrderFile);
router.delete('/:id/files/:fileId', deleteOrderFile);
router.get('/:id/files', getOrderFiles);

// Order history and analytics
router.get('/:id/history', getOrderHistory);
router.get('/:id/analytics', getOrderAnalytics);

// Admin routes
router.use(admin);
router.get('/', getOrders);

export default router; 