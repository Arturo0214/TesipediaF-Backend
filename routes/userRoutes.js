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

// Admin routes
router.get('/', adminOnly, getUsers);
router.get('/:id', adminOnly, getUserById);
router.put('/:id', adminOnly, updateUser);
router.delete('/:id', adminOnly, deleteUser);
router.put('/:id/role', adminOnly, updateUserRole);
router.put('/:id/status', adminOnly, updateUserStatus);

export default router; 