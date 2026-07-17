import express from 'express';
import { protect, adminOnly } from './../middleware/authMiddleware.js';
import { getLoopMetrics } from '../controllers/loopsController.js';

const router = express.Router();

// Métricas de los loops de negocio (precios, reactivación, objeciones) — solo admin
router.get('/', protect, adminOnly, getLoopMetrics);

export default router;
