import asyncHandler from 'express-async-handler';
import Order from '../models/Order.js';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import calculatePrice from '../utils/calculatePrice.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// 🆕 Crear nuevo pedido manual (usuario autenticado)
export const createOrder = asyncHandler(async (req, res) => {
  const {
    title,
    studyArea,
    educationLevel,
    pages,
    dueDate,
    requirements,
    quoteId,
  } = req.body;

  if (!title || !studyArea || !educationLevel || !pages || !dueDate) {
    res.status(400);
    throw new Error('Faltan campos obligatorios');
  }

  const price = calculatePrice(studyArea, educationLevel, pages);

  const order = await Order.create({
    user: req.user._id,
    title,
    studyArea,
    educationLevel,
    pages,
    dueDate,
    requirements,
    price,
    quoteId: quoteId || null,
  });

  await Notification.create({
    user: SUPER_ADMIN_ID,
    type: 'pedido',
    message: `📦 Nuevo pedido manual creado por ${req.user.name}`,
    data: {
      orderId: order._id,
      userId: req.user._id,
    },
  });  

  res.status(201).json(order);
});

export const createOrderFromQuote = asyncHandler(async (req, res) => {
  const { publicId } = req.params;

  const quote = await Quote.findOne({ publicId });

  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  if (!quote.user || quote.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('No autorizado para convertir esta cotización');
  }

  if (quote.convertedToOrder) {
    res.status(400);
    throw new Error('Esta cotización ya fue convertida en pedido');
  }

  const price = calculatePrice(quote.studyArea, quote.educationLevel, quote.pages);

  const newOrder = await Order.create({
    user: req.user._id,
    title: quote.taskTitle || 'Pedido desde cotización',
    studyArea: quote.studyArea,
    educationLevel: quote.educationLevel,
    pages: quote.pages,
    dueDate: quote.dueDate,
    requirements: quote.requirements,
    price,
    quoteId: quote._id,
  });

  quote.convertedToOrder = true;
  await quote.save();

  // 🛎️ Notificación para admins
  await Notification.create({
    user: SUPER_ADMIN_ID,
    type: 'pedido',
    message: `📦 Pedido creado desde cotización por ${req.user.name}`,
    data: {
      orderId: newOrder._id,
      quoteId: quote._id,
      userId: req.user._id,
    },
  });

  res.status(201).json({ message: 'Pedido creado a partir de cotización', order: newOrder });
});

// 📋 Obtener todos los pedidos del usuario autenticado
export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id });
  res.json(orders);
});

// 🔎 Obtener un pedido por ID (si es del usuario o redactor asignado)
export const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email')
    .populate('assignedTo', 'name email');

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  const isOwner = order.user._id.equals(req.user._id);
  const isWriter = order.assignedTo?.equals(req.user._id);
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isWriter && !isAdmin) {
    res.status(403);
    throw new Error('Acceso no autorizado');
  }

  res.json(order);
});

// 💳 Marcar pedido como pagado
export const markAsPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  order.isPaid = true;
  order.paymentDate = new Date();
  await order.save();

  res.json({ message: 'Pedido marcado como pagado' });
});

export const uploadDeliveryFile = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  const { fileUrl, comment } = req.body;

  if (!fileUrl) {
    res.status(400);
    throw new Error('No se envió archivo');
  }

  order.deliveryFiles.push({
    fileUrl,
    uploadedBy: req.user._id,
    comment: comment || '',
  });

  await order.save();

  // 🔔 Crear notificación al cliente (dueño del pedido)
  await Notification.create({
    user: order.user, // destinatario
    type: 'entrega',
    message: `Se ha entregado un archivo en tu pedido "${order.title}"`,
    data: {
      orderId: order._id.toString(),
      deliveredBy: req.user._id.toString(),
    },
  });

  res.json({ message: 'Archivo entregado con comentario', order });
});