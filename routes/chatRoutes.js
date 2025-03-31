import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
    generatePublicId,
    sendMessage,
    getMessagesByOrder,
    markMessagesAsRead,
    getMessages,
    getMessageById,
    updateMessage,
    deleteMessage,
    searchMessages,
    markAsRead,
    getConversations,
    getAuthenticatedConversations
} from '../controllers/chatController.js';

const router = express.Router();

// Public routes
router.post('/public-id', generatePublicId);
router.post('/send', sendMessage);

// Protected routes
router.use(protect);
router.get('/order/:orderId', getMessagesByOrder);
router.post('/mark-read', markMessagesAsRead);
router.get('/conversations', getConversations);
router.get('/authenticated-conversations', getAuthenticatedConversations);
router.post('/:id/read', markAsRead);

// Admin routes
router.use(adminOnly);
router.get('/', getMessages);
router.get('/search', searchMessages);
router.get('/:id', getMessageById);
router.put('/:id', updateMessage);
router.delete('/:id', deleteMessage);

export default router; 