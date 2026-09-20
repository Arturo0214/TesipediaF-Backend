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
  uploadComprobante,
  deleteComprobante,
  addAcuerdo,
  deleteAcuerdo,
  syncFireflies,
} from '../controllers/seguimientoController.js';

const router = express.Router();

// Todas las rutas requieren admin
router.use(protect);
router.use(adminOnly);

router.get('/', getSeguimientos);
// Fireflies: importar acuerdos de sesiones recientes (Haiku extrae fechas/correcciones)
router.post('/fireflies/sync', syncFireflies);
router.patch('/:type/:id', updateSeguimiento);
router.post('/:type/:id/nota', addNota);
router.delete('/:type/:id/nota/:notaId', deleteNota);
router.post('/:type/:id/archivo', upload.single('file'), uploadArchivo);
router.delete('/:type/:id/archivo/:archivoId', deleteArchivo);
// Comprobantes de pago por parcialidad (Contabilidad)
router.post('/:type/:id/comprobante', upload.single('file'), uploadComprobante);
router.delete('/:type/:id/comprobante/:comprobanteId', deleteComprobante);
// Acuerdos con el lead (correcciones + fecha de entrega)
router.post('/:type/:id/acuerdo', addAcuerdo);
router.delete('/:type/:id/acuerdo/:acuerdoId', deleteAcuerdo);

export default router;
