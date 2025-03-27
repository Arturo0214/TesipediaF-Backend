import express from 'express';
import {
  getAllUsers,
  deleteUser,
  toggleActiveStatus,
  getAllOrders,
  assignOrderToWriter,
  getStats,
  getAllVisits
} from '../controllers/adminController.js';

import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

// 🔐 Todas las rutas protegidas por login + rol admin
router.use(protect, adminOnly);

// 👥 Usuarios
router.get('/users', getAllUsers);
router.delete('/users/:id', deleteUser);
router.patch('/users/:id/status', toggleActiveStatus);

// 📦 Pedidos
router.get('/orders', getAllOrders);
router.patch('/orders/:id/assign', assignOrderToWriter);

// 📊 Estadísticas
router.get('/stats', getStats);

// Visitas
router.get('/visits', getAllVisits)

export default router;
