import express from 'express';
import {
  sendMessage,
  getMessagesByOrder,
  markMessagesAsRead,
} from '../controllers/chatController.js';

import { protect } from '../middleware/authMiddleware.js';
import multer from 'multer';

const router = express.Router();

// 📦 Configuración básica de multer
const storage = multer.diskStorage({});
const upload = multer({ storage });

router.use(protect);

// 📤 Enviar mensaje (con archivo opcional)
router.post('/', upload.single('file'), sendMessage);

// 📬 Obtener mensajes de un pedido
router.get('/:orderId', getMessagesByOrder);

// ✅ Marcar como leídos
router.patch('/:orderId/read', markMessagesAsRead);

export default router;
