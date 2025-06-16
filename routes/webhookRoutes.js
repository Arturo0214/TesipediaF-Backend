import express from 'express';
import { stripeWebhook, paymentWebhook, orderWebhook } from '../controllers/webhookController.js';

const router = express.Router();

// Ruta para manejar webhooks de Stripe (pagos normales y de invitados)
router.post('/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

// Otras rutas de webhook
router.post('/payment', paymentWebhook);
router.post('/order', orderWebhook);

export default router; 