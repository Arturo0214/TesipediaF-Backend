// routes/quoteRoutes.js
import express from 'express';
import {
  createQuote,
  getQuoteByPublicId,
  getMyQuotes,
  linkQuoteToUser,
} from '../controllers/quoteController.js';

import { protect } from '../middleware/authMiddleware.js';
import { quoteLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Crear una cotización pública
router.post('/', quoteLimiter, createQuote);

// Ver cotización sin estar logueado (por publicId)
router.get('/:publicId', getQuoteByPublicId);

// Obtener mis cotizaciones (logueado)
router.get('/my/list', protect, getMyQuotes);

// Asociar cotización existente a cuenta logueada
router.patch('/:publicId/link-user', protect, linkQuoteToUser);

export default router;

