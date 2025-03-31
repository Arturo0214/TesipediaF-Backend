import express from 'express';
import { protect, adminOnly, writerOnly } from '../middleware/authMiddleware.js';
import {
    getUsers,
    getUserById,
    updateUser,
    deleteUser,
    updateUserRole,
    updateUserStatus,
    getUserProfile,
    updateUserProfile,
} from '../controllers/userController.js';

const router = express.Router();

// Protected routes
router.use(protect);
router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);

// Writer routes
router.use(writerOnly);

// Admin routes
router.use(adminOnly);
router.get('/', getUsers);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.put('/:id/role', updateUserRole);
router.put('/:id/status', updateUserStatus);

export default router; 