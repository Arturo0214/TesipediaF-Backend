import express from 'express';
import { createCotizarLead, getCotizarLeads, updateCotizarLead } from '../controllers/cotizarLeadController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Público — recibe leads del formulario /cotizar
router.post('/', createCotizarLead);

// Protegido (admin) — ver y gestionar leads
router.get('/', protect, getCotizarLeads);
router.patch('/:id', protect, updateCotizarLead);

export default router;
