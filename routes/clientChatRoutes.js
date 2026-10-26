import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { getClientMessages, sendTeamMessage } from '../controllers/portalChatController.js';

// Admin: ver/responder el mini-chat de un cliente desde Proyectos
const router = express.Router();
router.use(protect, adminOnly);
router.get('/', getClientMessages);     // ?clientId= | ?clientEmail=&clientPhone=
router.post('/', sendTeamMessage);      // { clientId|clientEmail|clientPhone, text }

export default router;
