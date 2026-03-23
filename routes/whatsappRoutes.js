import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import upload from '../middleware/multer.js';
import {
  getLeads,
  getLeadByWaId,
  getLeadsStatus,
  getWindowStatus,
  toggleModoHumano,
  updateLeadEstado,
  sendMessage,
  sendTemplate,
  sendReengagement,
  claimLead,
} from '../controllers/whatsappController.js';

const router = express.Router();

// Todas las rutas requieren autenticación de admin
router.use(protect);
router.use(adminOnly);

// Leer leads / conversaciones
router.get('/leads', getLeads);
router.get('/leads-status', getLeadsStatus);
router.get('/leads/:waId', getLeadByWaId);
router.get('/leads/:waId/window-status', getWindowStatus);

// Toggle modo humano
router.patch('/leads/:waId/modo-humano', toggleModoHumano);

// Actualizar estado del lead
router.patch('/leads/:waId/estado', updateLeadEstado);

// Reclamar un lead (asignar dueño, solo si no tiene)
router.patch('/leads/:waId/claim', claimLead);

// Enviar mensaje con soporte para archivo adjunto
router.post('/send', upload.single('file'), sendMessage);

// Enviar solo la plantilla de seguimiento (revivir conversación)
router.post('/send-template', sendTemplate);

// Re-engagement masivo: enviar plantilla a leads inactivos en bienvenida/cotizando
router.post('/reengagement', sendReengagement);

export default router;
