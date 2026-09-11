import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  listPublicas, getPublica,
  listNoticias, getNoticia, crearNoticia, actualizarNoticia,
  publicarNoticia, despublicarNoticia, borrarNoticia, tendencias, recolectarNoticias,
} from '../controllers/noticiasController.js';

const router = express.Router();

// ── Admin (auth) — van ANTES de /:slug para que "admin" no choque con un slug ──
router.get('/admin/tendencias', protect, adminOnly, tendencias);
router.post('/admin/recolectar', protect, adminOnly, recolectarNoticias);
router.get('/admin', protect, adminOnly, listNoticias);
router.post('/admin', protect, adminOnly, crearNoticia);
router.get('/admin/:id', protect, adminOnly, getNoticia);
router.patch('/admin/:id', protect, adminOnly, actualizarNoticia);
router.post('/admin/:id/publicar', protect, adminOnly, publicarNoticia);
router.post('/admin/:id/despublicar', protect, adminOnly, despublicarNoticia);
router.delete('/admin/:id', protect, adminOnly, borrarNoticia);

// ── Público ──
router.get('/', listPublicas);
router.get('/:slug', getPublica);

export default router;
