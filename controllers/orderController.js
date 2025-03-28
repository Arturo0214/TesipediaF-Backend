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

// 📋 Obtener todos los pedidos (admin)
export const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate('user', 'name email');
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

// 🔍 Obtener pedido por ID (admin)
export const getOrderByIdAdmin = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email');
  if (order) {
    res.json(order);
  } else {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }
});

// 🔄 Actualizar pedido (admin)
export const updateOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.title = req.body.title || order.title;
    order.studyArea = req.body.studyArea || order.studyArea;
    order.educationLevel = req.body.educationLevel || order.educationLevel;
    order.pages = req.body.pages || order.pages;
    order.dueDate = req.body.dueDate || order.dueDate;
    order.requirements = req.body.requirements || order.requirements;
    order.status = req.body.status || order.status;
    order.price = req.body.price || order.price;

    const updatedOrder = await order.save();
    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }
});

// ❌ Eliminar pedido (admin)
export const deleteOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    await order.deleteOne();
    res.json({ message: 'Pedido eliminado correctamente' });
  } else {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }
});

// 🔍 Buscar pedidos
export const searchOrders = asyncHandler(async (req, res) => {
  const { query } = req.query;
  const orders = await Order.find({
    $or: [
      { title: { $regex: query, $options: 'i' } },
      { studyArea: { $regex: query, $options: 'i' } },
      { status: { $regex: query, $options: 'i' } },
    ],
  }).populate('user', 'name email');
  res.json(orders);
});

export const markAsPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('No autorizado para marcar este pedido como pagado');
  }

  // Marcar como pagado
  order.isPaid = true;
  order.paymentDate = new Date();

  // Actualizar estado del pedido si está pendiente
  if (order.status === 'pendiente') {
    order.status = order.assignedTo ? 'asignado' : 'en progreso';
  }

  await order.save();

  await Notification.create({
    user: SUPER_ADMIN_ID,
    type: 'pago',
    message: `💰 Pedido #${order._id} marcado como pagado por ${req.user.name}`,
    data: {
      orderId: order._id,
      userId: req.user._id,
    },
  });

  res.json({ message: 'Pedido marcado como pagado', order });
});


// 📤 Subir archivo de entrega
export const uploadDeliveryFile = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('No autorizado para subir archivos a este pedido');
  }

  if (!req.file) {
    res.status(400);
    throw new Error('No se ha subido ningún archivo');
  }

  order.deliveryFile = {
    url: req.file.path,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
  };

  await order.save();

  await Notification.create({
    user: order.user,
    type: 'entrega',
    message: `📤 Archivo de entrega subido para el pedido #${order._id}`,
    data: {
      orderId: order._id,
      fileUrl: req.file.path,
    },
  });

  res.json({ message: 'Archivo subido correctamente', order });
});

// 🔄 Actualizar estado del pedido
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('No autorizado para actualizar el estado del pedido');
  }

  order.status = req.body.status;
  await order.save();

  await Notification.create({
    user: order.user,
    type: 'estado',
    message: `🔄 Estado del pedido #${order._id} actualizado a ${req.body.status}`,
    data: {
      orderId: order._id,
      status: req.body.status,
    },
  });

  res.json({ message: 'Estado actualizado correctamente', order });
});

// 📤 Subir archivo al pedido
export const uploadOrderFile = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  if (!req.file) {
    res.status(400);
    throw new Error('No se ha subido ningún archivo');
  }

  order.files.push({
    name: req.file.originalname,
    url: req.file.path,
    uploadedBy: req.user._id,
    uploadedAt: new Date(),
  });

  await order.save();

  await Notification.create({
    user: order.user,
    type: 'archivo',
    message: `📎 Nuevo archivo subido al pedido #${order._id}`,
    data: {
      orderId: order._id,
      fileName: req.file.originalname,
    },
  });

  res.json({ message: 'Archivo subido correctamente', order });
});

// ❌ Eliminar archivo del pedido
export const deleteOrderFile = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  const file = order.files.id(req.params.fileId);
  if (!file) {
    res.status(404);
    throw new Error('Archivo no encontrado');
  }

  // Verificar permisos
  if (file.uploadedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('No autorizado para eliminar este archivo');
  }

  file.remove();
  await order.save();

  await Notification.create({
    user: order.user,
    type: 'archivo',
    message: `🗑️ Archivo eliminado del pedido #${order._id}`,
    data: {
      orderId: order._id,
      fileName: file.name,
    },
  });

  res.json({ message: 'Archivo eliminado correctamente', order });
});

// 📋 Obtener archivos del pedido
export const getOrderFiles = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  const isOwner = order.user.equals(req.user._id);
  const isWriter = order.assignedTo?.equals(req.user._id);
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isWriter && !isAdmin) {
    res.status(403);
    throw new Error('Acceso no autorizado');
  }

  res.json(order.files);
});

// 📊 Obtener historial del pedido
export const getOrderHistory = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  const isOwner = order.user.equals(req.user._id);
  const isWriter = order.assignedTo?.equals(req.user._id);
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isWriter && !isAdmin) {
    res.status(403);
    throw new Error('Acceso no autorizado');
  }

  const history = await Notification.find({
    'data.orderId': order._id,
  }).sort({ createdAt: -1 });

  res.json(history);
});

// 📈 Obtener análisis del pedido
export const getOrderAnalytics = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Acceso no autorizado');
  }

  const analytics = {
    totalFiles: order.files.length,
    totalNotifications: await Notification.countDocuments({ 'data.orderId': order._id }),
    timeInStatus: {
      pendiente: order.status === 'pendiente' ? Date.now() - order.createdAt : null,
      enProgreso: order.status === 'en progreso' ? Date.now() - order.updatedAt : null,
      completado: order.status === 'completado' ? order.completedAt - order.createdAt : null,
    },
    paymentStatus: order.isPaid ? 'pagado' : 'pendiente',
    assignedTo: order.assignedTo ? 'asignado' : 'sin asignar',
  };

  res.json(analytics);
});