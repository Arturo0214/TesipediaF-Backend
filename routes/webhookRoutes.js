import express from 'express';
import { stripeWebhook } from '../controllers/paymentController.js';
// import bodyParser from 'body-parser';

const router = express.Router();

// Stripe requiere el raw body para validar firma
router.post('/stripe', express.json(), stripeWebhook); 

export default router;
