import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { getSystemStatus } from '../controllers/statusController.js';

const router = express.Router();

// Estado del sistema (servidor Railway + Sofia/n8n) — solo admin
router.get('/', protect, adminOnly, getSystemStatus);

export default router;
