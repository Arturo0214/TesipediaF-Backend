import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import upload from '../middleware/multer.js';
import {
  getSeguimientos,
  addNota,
  deleteNota,
  updateSeguimiento,
  uploadArchivo,
  deleteArchivo,
} from '../controllers/seguimientoController.js';

const router = express.Router();

// Todas las rutas requieren admin
router.use(protect);
router.use(adminOnly);

router.get('/', getSeguimientos);
router.patch('/:type/:id', updateSeguimiento);
router.post('/:type/:id/nota', addNota);
router.delete('/:type/:id/nota/:notaId', deleteNota);
router.post('/:type/:id/archivo', upload.single('file'), uploadArchivo);
router.delete('/:type/:id/archivo/:archivoId', deleteArchivo);

export default router;
