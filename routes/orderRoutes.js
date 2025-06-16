import express from 'express';
import upload from '../middleware/multer.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  createOrder,
  createOrderFromQuote,
  getOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
  getMyOrders,
  markAsPaid,
  uploadDeliveryFile,
  updateOrderStatus,
  uploadOrderFile,
  deleteOrderFile,
  getOrderFiles,
  getOrderHistory,
  getOrderAnalytics,
  getAllOrders,
  cancelOrder,
} from '../controllers/orderController.js';

const router = express.Router();

// Rutas públicas
router.get('/analytics', getOrderAnalytics);

// Rutas protegidas
router.use(protect);
router.post('/', createOrder); // Crear nuevo pedido
router.post('/from-quote/:publicId', createOrderFromQuote); // Crear nuevo pedido desde cotización
router.get('/my-orders', getMyOrders); // Ver mis pedidos
router.get('/:id', getOrderById); // Ver detalle de pedido
router.put('/:id', updateOrder); // Actualizar pedido
router.delete('/:id', deleteOrder); // Eliminar pedido
router.put('/:id/mark-paid', markAsPaid); // Marcar como pagado
router.post('/:id/delivery-file', upload.single('file'), uploadDeliveryFile); // Subir archivo de entrega
router.put('/:id/status', updateOrderStatus); // Cambiar estado
router.post('/:id/files', uploadOrderFile); // Subir archivo
router.delete('/:id/files/:fileId', deleteOrderFile); // Eliminar archivo
router.get('/:id/files', getOrderFiles); // Obtener archivos
router.get('/:id/history', getOrderHistory); // Historial
router.post('/:id/cancel', cancelOrder); // Cancelar pedido

// Rutas de admin
router.use(adminOnly);
router.get('/', getAllOrders); // Listar todos los pedidos (solo admin)

export default router;
