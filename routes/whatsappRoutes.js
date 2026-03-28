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
  getAutoReminderStatus,
  configAutoReminder,
  toggleBlockLead,
  runRevival,
  getRevivalStatus,
  configRevival,
  incomingMessageWebhook,
  runQuoteFollowUp,
  getQuoteFollowUpStatus,
  configQuoteFollowUp,
} from '../controllers/whatsappController.js';

const router = express.Router();

// ─── Rutas PÚBLICAS (sin auth) — webhooks llamados por n8n/Sofia ───
router.post('/incoming-webhook', incomingMessageWebhook);

// ─── Rutas protegidas (admin) ───
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

// Bloquear / desbloquear un contacto
router.patch('/leads/:waId/block', toggleBlockLead);

// Enviar mensaje con soporte para archivo adjunto
router.post('/send', upload.single('file'), sendMessage);

// Enviar solo la plantilla de seguimiento (revivir conversación)
router.post('/send-template', sendTemplate);

// Re-engagement masivo: Sofia envia recordatorios a leads estancados
router.post('/reengagement', sendReengagement);

// Auto-reminder de Sofia: config y status
router.get('/auto-reminder', getAutoReminderStatus);
router.post('/auto-reminder', configAutoReminder);

// Lead Revival — Sofia revive leads fríos/descartados
router.post('/revival', runRevival);
router.get('/revival/status', getRevivalStatus);
router.post('/revival/config', configRevival);

// Quote Follow-up — Seguimiento automático a leads con cotización
router.post('/quote-followup', runQuoteFollowUp);
router.get('/quote-followup/status', getQuoteFollowUpStatus);
router.post('/quote-followup/config', configQuoteFollowUp);

export default router;
