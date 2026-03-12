import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getLeads,
  getLeadByWaId,
  toggleModoHumano,
  sendMessage,
} from '../controllers/whatsappController.js';

const router = express.Router();

// Todas las rutas requieren autenticación de admin
router.use(protect);
router.use(adminOnly);

// Leer leads / conversaciones
router.get('/leads', getLeads);
router.get('/leads/:waId', getLeadByWaId);

// Toggle modo humano
router.patch('/leads/:waId/modo-humano', toggleModoHumano);

// Enviar mensaje
router.post('/send', sendMessage);

export default router;
