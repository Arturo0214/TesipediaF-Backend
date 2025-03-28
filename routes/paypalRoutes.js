import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  createPayPalOrder,
  capturePayPalPayment,
  refundPayPalPayment,
  getPayPalRefundStatus,
} from '../controllers/paypalController.js';

const router = express.Router();

router.use(protect); // Solo autenticación, no admin

router.post('/create', createPayPalOrder);         // ✅ Usuarios normales pueden crear orden
router.post('/capture', capturePayPalPayment);     // ✅ Usuarios normales capturan
router.post('/refund/:id', refundPayPalPayment);   // ✅ Puedes aquí luego usar admin si quieres
router.get('/refund-status/:id', getPayPalRefundStatus);

export default router;
