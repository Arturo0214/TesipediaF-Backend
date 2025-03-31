import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    getAllUsers,
    deleteUser,
    toggleActiveStatus,
    getAllOrders,
    assignOrderToWriter,
    getStats,
    getAllVisits,
    getDashboard,
    searchAdmin,
    getOrderById,
    updateOrder
} from '../controllers/adminController.js';

const router = express.Router();

// All routes require admin authentication
router.use(protect);
router.use(adminOnly);

// User management
router.get('/users', getAllUsers);
router.delete('/users/:id', deleteUser);
router.put('/users/:id/toggle-active', toggleActiveStatus);

// Order management
router.get('/orders', getAllOrders);
router.get('/orders/:id', getOrderById);
router.put('/orders/:id', updateOrder);
router.post('/orders/:id/assign', assignOrderToWriter);

// Statistics and dashboard
router.get('/stats', getStats);
router.get('/dashboard', getDashboard);
router.get('/visits', getAllVisits);

// Search functionality
router.get('/search', searchAdmin);

export default router; 