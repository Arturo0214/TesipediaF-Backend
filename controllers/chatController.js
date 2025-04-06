import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import crypto from 'crypto';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import Order from '../models/Order.js';
import cloudinary from '../config/cloudinary.js';
import User from '../models/User.js';
import Visit from '../models/Visit.js';
import getGeoFromIP from '../utils/geoLookup.js';

const DEFAULT_ADMIN_ID = process.env.SUPER_ADMIN_ID

export const generatePublicId = asyncHandler(async (req, res) => {
  const publicId = crypto.randomBytes(16).toString('hex');
  res.json({ publicId, message: 'ID público generado exitosamente' });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const { receiver, text, orderId, name, email, publicId } = req.body;
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  let geoData = null;
  try {
    geoData = await getGeoFromIP(clientIP);
  } catch (error) {
    console.error('Error obteniendo datos geográficos:', error.message);
  }

  let sender, senderName, isPublic = false, finalReceiver;

  // Si hay publicId, es un mensaje público
  if (publicId) {
    sender = publicId;
    senderName = name || 'Usuario Anónimo';
    isPublic = true;
    finalReceiver = DEFAULT_ADMIN_ID; // 🚀 Siempre va para el admin
  }
  else if (req.user) {
    // Usuario autenticado
    sender = req.user._id;
    senderName = req.user.name;
    isPublic = false;

    if (req.user.role === 'admin') {
      if (!receiver || !mongoose.Types.ObjectId.isValid(receiver)) {
        res.status(400);
        throw new Error('ID de receptor inválido para admin');
      }
      finalReceiver = receiver;
    }
    else if (req.user.role === 'writer') {
      if (!receiver || !mongoose.Types.ObjectId.isValid(receiver)) {
        res.status(400);
        throw new Error('ID de receptor inválido para writer');
      }
      if (receiver !== DEFAULT_ADMIN_ID && orderId) {
        // Solo si hay orderId validamos
        const order = await Order.findOne({ _id: orderId, writer: req.user._id, client: receiver });
        if (!order) {
          throw new Error('No autorizado para enviar mensaje a este usuario');
        }
      }
      finalReceiver = receiver;
    }
    else {
      res.status(403);
      throw new Error('No autorizado');
    }
  }
  else {
    res.status(401);
    throw new Error('No autorizado: se requiere publicId o autenticación');
  }

  if (!finalReceiver || !mongoose.Types.ObjectId.isValid(finalReceiver)) {
    res.status(400);
    throw new Error('No se pudo determinar el receptor');
  }

  const newMessage = new Message({
    sender,
    receiver: new mongoose.Types.ObjectId(finalReceiver),
    orderId: orderId && mongoose.Types.ObjectId.isValid(orderId) ? new mongoose.Types.ObjectId(orderId) : null, // 🔥 Aquí ya no trona si orderId no existe
    text,
    isPublic,
    senderName,
    senderIP: clientIP,
    geoLocation: geoData ? {
      city: geoData.city,
      region: geoData.region,
      country: geoData.country,
      org: geoData.org,
      coordinates: geoData.loc
    } : null
  });

  if (isPublic) {
    const oneDayLater = new Date();
    oneDayLater.setDate(oneDayLater.getDate() + 1);
    newMessage.expiresAt = oneDayLater;
  }

  if (req.file) {
    newMessage.attachment = {
      url: req.file.path,
      fileName: req.file.originalname,
    };
  }

  const savedMessage = await newMessage.save();

  await Notification.create({
    user: new mongoose.Types.ObjectId(finalReceiver),
    type: 'mensaje',
    message: `Nuevo mensaje de ${senderName}`,
    data: {
      orderId: savedMessage.orderId, // ahora puede ser null
      sender: sender.toString(),
      isPublic,
    },
  });

  res.status(201).json(savedMessage);
});


// 📬 Obtener mensajes por OrderId o conversación directa
export const getMessagesByOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user?._id;
  const publicId = req.query.publicId; // viene de ?publicId=xxx

  let query = {};

  if (publicId) {
    // 🚀 Prioridad máxima al publicId
    query = {
      sender: publicId,
      isPublic: true,
    };
  } else if (orderId && orderId !== 'null') {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      res.status(400);
      throw new Error('ID de pedido inválido');
    }
    query = { orderId: new mongoose.Types.ObjectId(orderId) };
  } else if (userId) {
    query = {
      $or: [{ sender: userId }, { receiver: userId }],
    };
  } else {
    res.status(400);
    throw new Error('Se requiere ID de usuario, pedido o ID público');
  }

  const messages = await Message.find(query)
    .populate('sender', 'name role')
    .populate('receiver', 'name role')
    .sort({ createdAt: 1 });

  res.json(messages);
});

// 📬 Obtener mensajes públicos por PublicId
export const getPublicMessagesByPublicId = asyncHandler(async (req, res) => {
  const { publicId } = req.params;

  if (!publicId || typeof publicId !== 'string') {
    res.status(400);
    throw new Error('ID público inválido');
  }

  const messages = await Message.find({ sender: publicId, isPublic: true })
    .sort({ createdAt: 1 });

  res.json(messages);
});

// 📬 Obtener mensajes públicos por OrderId
export const getPublicMessagesByOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    res.status(400);
    throw new Error('ID de pedido inválido');
  }

  const messages = await Message.find({ orderId, isPublic: true })
    .sort({ createdAt: 1 });

  res.json(messages);
});

// ✅ Marcar todos los mensajes como leídos
export const markMessagesAsRead = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;

  await Message.updateMany(
    { orderId, receiver: userId, isRead: false },
    { $set: { isRead: true } }
  );

  res.json({ message: 'Mensajes marcados como leídos' });
});

// 📋 Obtener todos los mensajes (admin)
export const getMessages = asyncHandler(async (req, res) => {
  const messages = await Message.find({})
    .populate('sender', 'name email role')
    .populate('receiver', 'name email role')
    .sort({ createdAt: -1 });

  res.json(messages);
});

// 🔍 Obtener mensaje por ID
export const getMessageById = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id)
    .populate('sender', 'name email role')
    .populate('receiver', 'name email role');

  if (!message) {
    res.status(404);
    throw new Error('Mensaje no encontrado');
  }

  res.json(message);
});

// 🔄 Actualizar mensaje
export const updateMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);

  if (!message) {
    res.status(404);
    throw new Error('Mensaje no encontrado');
  }

  message.text = req.body.text || message.text;
  message.isRead = req.body.isRead !== undefined ? req.body.isRead : message.isRead;

  const updatedMessage = await message.save();
  res.json(updatedMessage);
});

// ❌ Eliminar mensaje (y archivo adjunto si existe)
export const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);

  if (!message) {
    res.status(404);
    throw new Error('Mensaje no encontrado');
  }

  if (message.attachment && message.attachment.publicId) {
    try {
      await cloudinary.uploader.destroy(message.attachment.publicId, {
        resource_type: 'auto'
      });
      console.log(`Archivo ${message.attachment.publicId} eliminado de Cloudinary`);
    } catch (error) {
      console.error('Error eliminando archivo de Cloudinary:', error.message);
    }
  }

  await message.deleteOne();
  res.json({ message: 'Mensaje eliminado correctamente' });
});

// 🔍 Buscar mensajes
export const searchMessages = asyncHandler(async (req, res) => {
  const { query } = req.query;

  const messages = await Message.find({
    $or: [
      { text: { $regex: query, $options: 'i' } },
      { 'attachment.fileName': { $regex: query, $options: 'i' } }
    ]
  })
    .populate('sender', 'name email role')
    .populate('receiver', 'name email role')
    .sort({ createdAt: -1 });

  res.json(messages);
});

// ✅ Marcar un mensaje como leído
export const markAsRead = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);

  if (!message) {
    res.status(404);
    throw new Error('Mensaje no encontrado');
  }

  if (message.receiver.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('No autorizado para marcar este mensaje como leído');
  }

  message.isRead = true;
  await message.save();

  res.json({ message: 'Mensaje marcado como leído', message });
});

// 💬 Obtener todas las conversaciones
export const getConversations = asyncHandler(async (req, res) => {
  const messages = await Message.find({ receiver: req.user._id }).sort({ createdAt: -1 });

  const conversations = messages.reduce((acc, message) => {
    const senderId = message.sender.toString();
    if (!acc[senderId]) {
      acc[senderId] = {
        senderId,
        senderName: message.senderName,
        isPublic: message.isPublic,
        lastMessage: message.text,
        lastMessageDate: message.createdAt,
        unreadCount: message.isRead ? 0 : 1,
        messages: [message]
      };
    } else {
      acc[senderId].messages.push(message);
      if (!message.isRead) acc[senderId].unreadCount++;
      if (message.createdAt > acc[senderId].lastMessageDate) {
        acc[senderId].lastMessage = message.text;
        acc[senderId].lastMessageDate = message.createdAt;
      }
    }
    return acc;
  }, {});

  res.json(Object.values(conversations).sort((a, b) => b.lastMessageDate - a.lastMessageDate));
});

// 💬 Obtener conversaciones autenticadas
export const getAuthenticatedConversations = asyncHandler(async (req, res) => {
  const messages = await Message.find({ receiver: req.user._id, isPublic: false })
    .populate('sender', 'name email role')
    .sort({ createdAt: -1 });

  const conversations = messages.reduce((acc, message) => {
    const senderId = message.sender._id.toString();
    if (!acc[senderId]) {
      acc[senderId] = {
        senderId,
        senderName: message.sender.name,
        senderEmail: message.sender.email,
        senderRole: message.sender.role,
        lastMessage: message.text,
        lastMessageDate: message.createdAt,
        unreadCount: message.isRead ? 0 : 1,
        messages: [message]
      };
    } else {
      acc[senderId].messages.push(message);
      if (!message.isRead) acc[senderId].unreadCount++;
      if (message.createdAt > acc[senderId].lastMessageDate) {
        acc[senderId].lastMessage = message.text;
        acc[senderId].lastMessageDate = message.createdAt;
      }
    }
    return acc;
  }, {});

  res.json(Object.values(conversations).sort((a, b) => b.lastMessageDate - a.lastMessageDate));
});

// 💬 Obtener conversaciones públicas
export const getPublicConversations = asyncHandler(async (req, res) => {
  const messages = await Message.find({ receiver: req.user._id, isPublic: true }).sort({ createdAt: -1 });

  const conversations = messages.reduce((acc, message) => {
    const senderId = message.sender.toString();
    if (!acc[senderId]) {
      acc[senderId] = {
        senderId,
        senderName: message.senderName,
        lastMessage: message.text,
        lastMessageDate: message.createdAt,
        unreadCount: message.isRead ? 0 : 1,
        messages: [message]
      };
    } else {
      acc[senderId].messages.push(message);
      if (!message.isRead) acc[senderId].unreadCount++;
      if (message.createdAt > acc[senderId].lastMessageDate) {
        acc[senderId].lastMessage = message.text;
        acc[senderId].lastMessageDate = message.createdAt;
      }
    }
    return acc;
  }, {});

  res.json(Object.values(conversations).sort((a, b) => b.lastMessageDate - a.lastMessageDate));
});

// 📈 Tracking de visitas
export const trackVisit = asyncHandler(async (req, res) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  let geoData = null;
  try {
    geoData = await getGeoFromIP(clientIP);
  } catch (error) {
    console.error('Error obteniendo geo datos:', error.message);
  }

  const visit = new Visit({
    ip: clientIP,
    userAgent: req.headers['user-agent'],
    referrer: req.headers.referer || 'Direct',
    path: req.body.path || '/',
    geoLocation: geoData ? {
      city: geoData.city,
      region: geoData.region,
      country: geoData.country,
      org: geoData.org,
      coordinates: geoData.loc
    } : null
  });

  await visit.save();

  res.status(201).json({ success: true, message: 'Visita registrada correctamente' });
});
