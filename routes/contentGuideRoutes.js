import express from 'express';
import { protect, adminOnly } from './../middleware/authMiddleware.js';
import {
  generateGuidesFromCorpus,
  listGuides,
  updateGuide,
  publishGuide,
  deleteGuide,
  getPublicGuide,
} from '../controllers/contentGuideController.js';

const router = express.Router();

// Público: la landing consume la guía publicada por slug
router.get('/public/:slug', getPublicGuide);

// Admin: generar desde corpus, listar, editar, publicar, borrar
router.post('/generate', protect, adminOnly, generateGuidesFromCorpus);
router.get('/', protect, adminOnly, listGuides);
router.put('/:id', protect, adminOnly, updateGuide);
router.patch('/:id/publish', protect, adminOnly, publishGuide);
router.delete('/:id', protect, adminOnly, deleteGuide);

export default router;
