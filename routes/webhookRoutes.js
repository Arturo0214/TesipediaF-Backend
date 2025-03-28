import express from 'express';
import { stripeWebhook } from '../controllers/paymentController.js';

const router = express.Router();

// Ruta para manejar webhooks de Stripe
// Esta ruta necesita el body raw, por eso no usa express.json()
router.post('/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

export default router; 