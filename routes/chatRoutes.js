import express from 'express';
import { protect, adminOnly, optionalAuth } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';
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
    getPublicConversations,
    trackVisit,
    getDirectMessages,
    deleteConversation
} from '../controllers/chatController.js';

const router = express.Router();

// 🔓 Rutas completamente públicas (sin ningún tipo de autenticación)
router.post('/public-id', generatePublicId);
router.get('/public-id', generatePublicId);
router.get('/public/conversation/:publicId', getPublicMessagesByPublicId);
router.post('/track-visit', trackVisit);

// 🔄 Rutas que pueden ser públicas o autenticadas
router.post('/send', optionalAuth, upload.single('attachment'), sendMessage);

// 🔒 Rutas que requieren autenticación
router.use('/order', protect);
router.get('/order/:orderId', getMessagesByOrder);
router.post('/order/:orderId/mark-read', markMessagesAsRead);

// 💬 Rutas de conversaciones (requieren autenticación)
router.get('/conversations', protect, getConversations);
router.get('/authenticated-conversations', protect, getAuthenticatedConversations);
router.get('/public-conversations', protect, getPublicConversations);
router.get('/direct/:userId', protect, getDirectMessages);

// ✅ Rutas de marcado de mensajes
router.post('/:id/read', protect, markAsRead);

// 👑 Rutas de administrador
router.use(protect, adminOnly);

// IMPORTANTE: Primero colocamos las rutas más específicas
router.delete('/conversations/:conversationId', deleteConversation);

// Después las rutas con comodines
router.get('/', getMessages);
router.get('/search', searchMessages);
router.get('/:id', getMessageById);
router.put('/:id', updateMessage);
router.delete('/:id', deleteMessage);

export default router;
