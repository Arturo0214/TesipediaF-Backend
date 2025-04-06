import express from 'express';
import { protect, adminOnly, optionalAuth } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js'; // 🚀 Importar tu upload middleware
import {
    generatePublicId,
    sendMessage,
    getMessagesByOrder,
    getPublicMessagesByPublicId,
    getPublicMessagesByOrder,
    markMessagesAsRead,
    getMessages,
    getMessageById,
    updateMessage,
    deleteMessage,
    searchMessages,
    markAsRead,
    getConversations,
    getAuthenticatedConversations,
    getPublicConversations
} from '../controllers/chatController.js';

const router = express.Router();

// 🔓 Public routes (sin protección de token)
router.post('/public-id', generatePublicId);
router.post('/send', optionalAuth, upload.single('attachment'), sendMessage); // 🛡️ optionalAuth aquí
router.get('/public/conversation/:publicId', getPublicMessagesByPublicId);
router.get('/public/:orderId', getPublicMessagesByOrder);
// Order-specific routes (solo para usuarios autenticados)
router.get('/order/:orderId', (req, res, next) => {
    if (req.params.orderId === 'null') {
        // No sobrescribimos el publicId si existe
        return getMessagesByOrder(req, res, next);
    }
    return getMessagesByOrder(req, res, next);
});

// 🔒 Protected routes (requieren token)
router.use(protect);


router.post('/order/:orderId/mark-read', markMessagesAsRead);

// Conversation routes (solo para usuarios autenticados)
router.get('/conversations', getConversations);
router.get('/authenticated-conversations', getAuthenticatedConversations);
router.get('/public-conversations', getPublicConversations);
router.post('/:id/read', markAsRead);

// 🛡️ Admin routes (requieren ser admin)
router.use(adminOnly);

router.get('/', getMessages); // Obtener todos los mensajes (admin)
router.get('/search', searchMessages);
router.get('/:id', getMessageById);
router.put('/:id', updateMessage);
router.delete('/:id', deleteMessage);

export default router;
