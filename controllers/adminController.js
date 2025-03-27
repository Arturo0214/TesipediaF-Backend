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