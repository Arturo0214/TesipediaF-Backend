import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Quote from '../models/Quote.js';
import Visit from '../models/Visit.js';

export const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find({}).select('-password');
  res.json(users);
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }

  if (user.role === 'admin') {
    res.status(403);
    throw new Error('No puedes eliminar a otro administrador');
  }

  await user.deleteOne();

  res.json({ message: 'Usuario eliminado correctamente' });
});

export const toggleActiveStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }

  user.isActive = !user.isActive;
  await user.save();

  res.json({
    message: `Usuario ${user.isActive ? 'activado' : 'desactivado'} correctamente`,
  });
});

export const getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({})
    .populate('user', 'name email')
    .populate('assignedTo', 'name email');

  res.json(orders);
});

export const assignOrderToWriter = asyncHandler(async (req, res) => {
  const { writerId } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }

  order.assignedTo = writerId;
  order.status = 'asignado';
  await order.save();

  res.json({ message: 'Redactor asignado correctamente', order });
});

export const getStats = asyncHandler(async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalWriters = await User.countDocuments({ role: 'redactor' });
  const totalOrders = await Order.countDocuments();
  const totalQuotes = await Quote.countDocuments();
  const totalVisits = await Visit.countDocuments();

  const totalIncome = await Order.aggregate([
    { $match: { isPaid: true } },
    { $group: { _id: null, total: { $sum: '$price' } } }
  ]);

  const uniqueVisitors = await Visit.distinct('cookieId');

  res.json({
    totalUsers,
    totalWriters,
    totalOrders,
    totalQuotes,
    totalIncome: totalIncome[0]?.total || 0,
    totalVisits,
    uniqueVisitors: uniqueVisitors.length,
  });
});

export const getAllVisits = asyncHandler(async (req, res) => {
  const visits = await Visit.find({})
    .sort({ createdAt: -1 }) // las más recientes primero
    .limit(200); // puedes ajustar esto para paginación

  res.json(visits);
});

// 📊 Dashboard
export const getDashboard = asyncHandler(async (req, res) => {
  // Estadísticas generales
  const totalUsers = await User.countDocuments();
  const totalOrders = await Order.countDocuments();
  const totalQuotes = await Quote.countDocuments();
  const totalVisits = await Visit.countDocuments();

  // Pedidos recientes
  const recentOrders = await Order.find({})
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(5);

  // Cotizaciones recientes
  const recentQuotes = await Quote.find({})
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(5);

  // Usuarios nuevos
  const newUsers = await User.find({})
    .select('-password')
    .sort({ createdAt: -1 })
    .limit(5);

  // Visitas recientes
  const recentVisits = await Visit.find({})
    .sort({ createdAt: -1 })
    .limit(5);

  // Ingresos totales
  const totalIncome = await Order.aggregate([
    { $match: { isPaid: true } },
    { $group: { _id: null, total: { $sum: '$price' } } }
  ]);

  res.json({
    stats: {
      totalUsers,
      totalOrders,
      totalQuotes,
      totalVisits,
      totalIncome: totalIncome[0]?.total || 0,
    },
    recentData: {
      orders: recentOrders,
      quotes: recentQuotes,
      users: newUsers,
      visits: recentVisits,
    }
  });
});

// 🔍 Búsqueda administrativa
export const searchAdmin = asyncHandler(async (req, res) => {
  const { query, type } = req.query;

  if (!query || !type) {
    res.status(400);
    throw new Error('Se requiere un término de búsqueda y un tipo');
  }

  let results = [];

  switch (type) {
    case 'users':
      results = await User.find({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } },
        ]
      }).select('-password');
      break;

    case 'orders':
      results = await Order.find({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { status: { $regex: query, $options: 'i' } },
        ]
      }).populate('user', 'name email');
      break;

    case 'quotes':
      results = await Quote.find({
        $or: [
          { taskTitle: { $regex: query, $options: 'i' } },
          { studyArea: { $regex: query, $options: 'i' } },
        ]
      }).populate('user', 'name email');
      break;

    default:
      res.status(400);
      throw new Error('Tipo de búsqueda no válido');
  }

  res.json(results);
});

// 📦 Gestión de pedidos
export const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email')
    .populate('assignedTo', 'name email');

  if (order) {
    res.json(order);
  } else {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }
});

export const updateOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    // Validar el status
    const validStatuses = ['pendiente', 'asignado', 'en progreso', 'entregado', 'cancelado'];
    if (req.body.status && !validStatuses.includes(req.body.status)) {
      res.status(400);
      throw new Error('Estado no válido. Valores permitidos: pendiente, asignado, en progreso, entregado, cancelado');
    }

    // Validar requirements
    if (req.body.requirements) {
      if (typeof req.body.requirements === 'string') {
        // Si es string, convertirlo a objeto
        req.body.requirements = {
          text: req.body.requirements,
          file: null
        };
      } else if (typeof req.body.requirements !== 'object') {
        res.status(400);
        throw new Error('El campo requirements debe ser un objeto con la estructura { text: string, file: string }');
      }
    }

    // Actualizar campos
    order.title = req.body.title || order.title;
    order.status = req.body.status || order.status;
    order.price = req.body.price || order.price;
    order.dueDate = req.body.dueDate || order.dueDate;
    order.requirements = req.body.requirements || order.requirements;

    const updatedOrder = await order.save();
    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Pedido no encontrado');
  }
});

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

// 📝 Gestión de cotizaciones
export const getQuotes = asyncHandler(async (req, res) => {
  const quotes = await Quote.find({})
    .populate('user', 'name email')
    .sort({ createdAt: -1 });
  res.json(quotes);
});

export const getQuoteById = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id)
    .populate('user', 'name email');

  if (quote) {
    res.json(quote);
  } else {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }
});

export const updateQuote = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id);

  if (quote) {
    quote.taskTitle = req.body.taskTitle || quote.taskTitle;
    quote.studyArea = req.body.studyArea || quote.studyArea;
    quote.educationLevel = req.body.educationLevel || quote.educationLevel;
    quote.pages = req.body.pages || quote.pages;
    quote.dueDate = req.body.dueDate || quote.dueDate;
    quote.requirements = req.body.requirements || quote.requirements;
    quote.estimatedPrice = req.body.estimatedPrice || quote.estimatedPrice;

    const updatedQuote = await quote.save();
    res.json(updatedQuote);
  } else {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }
});

export const deleteQuote = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id);

  if (quote) {
    await quote.deleteOne();
    res.json({ message: 'Cotización eliminada correctamente' });
  } else {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }
});