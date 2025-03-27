// routes/orderRoutes.js
import express from 'express';
import {
  createOrder,
  getMyOrders,
  getOrderById,
  markAsPaid,
  uploadDeliveryFile,
  createOrderFromQuote,
} from '../controllers/orderController.js';

import { protect } from '../middleware/authMiddleware.js';
import { orderLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Crear un pedido manualmente
router.post('/', protect, orderLimiter, createOrder);

// Crear un pedido desde una cotización pública (requiere que ya esté vinculada al usuario)
router.post('/from-quote/:publicId', protect, orderLimiter, createOrderFromQuote);

// Ver todos mis pedidos
router.get('/my', protect, getMyOrders);

// Ver un pedido específico
router.get('/:id', protect, getOrderById);

// Marcar como pagado
router.patch('/:id/pay', protect, markAsPaid);

// Subir archivo de entrega
router.post('/:id/deliver', protect, uploadDeliveryFile);

export default router;
