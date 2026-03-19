import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import upload from '../middleware/multer.js';
import {
  getLeads,
  getLeadByWaId,
  getLeadsStatus,
  toggleModoHumano,
  updateLeadEstado,
  sendMessage,
} from '../controllers/whatsappController.js';

const router = express.Router();

// Todas las rutas requieren autenticación de admin
router.use(protect);
router.use(adminOnly);

// Leer leads / conversaciones
router.get('/leads', getLeads);
router.get('/leads-status', getLeadsStatus);
router.get('/leads/:waId', getLeadByWaId);

// Toggle modo humano
router.patch('/leads/:waId/modo-humano', toggleModoHumano);

// Actualizar estado del lead
router.patch('/leads/:waId/estado', updateLeadEstado);

// Enviar mensaje con soporte para archivo adjunto
router.post('/send', upload.single('file'), sendMessage);

export default router;
