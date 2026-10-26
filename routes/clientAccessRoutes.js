import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { revealAccess, regenerateAccess, resendAccess } from '../controllers/clientAccessController.js';

const router = express.Router();

// Solo admin: ver/regenerar/reenviar las credenciales del portal del cliente
router.use(protect);
router.use(adminOnly);

router.post('/reveal', revealAccess);
router.post('/regenerate', regenerateAccess);
router.post('/resend', resendAccess);

export default router;
