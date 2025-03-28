import asyncHandler from 'express-async-handler';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import crypto from 'crypto';
import mongoose from 'mongoose';

// 🔑 Generar ID público único
export const generatePublicId = asyncHandler(async (req, res) => {
  // Generar un ID único usando crypto
  const publicId = crypto.randomBytes(16).toString('hex');

  res.json({
    publicId,
    message: 'ID público generado exitosamente'
  });
});

// 📤 Enviar mensaje (con o sin archivo)
export const sendMessage = asyncHandler(async (req, res) => {
  const { receiver, text, orderId, name, email, publicId } = req.body;

  // Validar que el receiver sea un ObjectId válido
  if (!mongoose.Types.ObjectId.isValid(receiver)) {
    res.status(400);
    throw new Error('ID de receptor no válido');
  }

  // Si el usuario está autenticado, usar su ID como sender
  // Si no, usar el publicId como identificador
  let sender;
  let senderName;
  let isPublic = false;

  if (req.user) {
    // Usuario autenticado
    sender = req.user._id;
    senderName = req.user.name;
    isPublic = false;
  } else {
    // Usuario no autenticado
    if (!publicId) {
      res.status(400);
      throw new Error('Se requiere un identificador público para enviar mensajes sin autenticación');
    }
    sender = publicId;
    senderName = name || 'Usuario Anónimo';
    isPublic = true;
  }

  const newMessage = new Message({
    sender,
    receiver: new mongoose.Types.ObjectId(receiver),
    orderId: orderId ? new mongoose.Types.ObjectId(orderId) : null,
    text,
    isPublic,
    senderName
  });

  // Si hay archivo adjunto (req.file viene de multer)
  if (req.file) {
    newMessage.attachment = {
      url: req.file.path,
      fileName: req.file.originalname,
    };
  }

  const savedMessage = await newMessage.save();

  // 🔔 Crear notificación con nombre del remitente
  await Notification.create({
    user: new mongoose.Types.ObjectId(receiver),
    type: 'mensaje',
    message: `Nuevo mensaje de ${senderName}`,
    data: {
      orderId: orderId ? new mongoose.Types.ObjectId(orderId) : null,
      sender: sender.toString(),
      isPublic
    },
  });

  res.status(201).json(savedMessage);
});

// 📬 Obtener todos los mensajes de un pedido (cliente/admin/redactor)
export const getMessagesByOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const messages = await Message.find({ orderId })
    .populate('sender', 'name role')
    .populate('receiver', 'name role')
    .sort({ createdAt: 1 }); // orden cronológico

  res.json(messages);
});

// ✅ Marcar todos los mensajes como leídos por el receptor actual
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

// 🔍 Obtener mensaje por ID (admin)
export const getMessageById = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id)
    .populate('sender', 'name email role')
    .populate('receiver', 'name email role');

  if (message) {
    res.json(message);
  } else {
    res.status(404);
    throw new Error('Mensaje no encontrado');
  }
});

// 🔄 Actualizar mensaje (admin)
export const updateMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);

  if (message) {
    message.text = req.body.text || message.text;
    message.isRead = req.body.isRead !== undefined ? req.body.isRead : message.isRead;

    const updatedMessage = await message.save();
    res.json(updatedMessage);
  } else {
    res.status(404);
    throw new Error('Mensaje no encontrado');
  }
});

// ❌ Eliminar mensaje (admin)
export const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);

  if (message) {
    await message.deleteOne();
    res.json({ message: 'Mensaje eliminado correctamente' });
  } else {
    res.status(404);
    throw new Error('Mensaje no encontrado');
  }
});

// 🔍 Buscar mensajes
export const searchMessages = asyncHandler(async (req, res) => {
  const { query } = req.query;
  const messages = await Message.find({
    $or: [
      { text: { $regex: query, $options: 'i' } },
      { 'attachment.fileName': { $regex: query, $options: 'i' } },
    ],
  })
    .populate('sender', 'name email role')
    .populate('receiver', 'name email role')
    .sort({ createdAt: -1 });
  res.json(messages);
});

// ✅ Marcar mensaje como leído
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

// 💬 Obtener todas las conversaciones (admin)
export const getConversations = asyncHandler(async (req, res) => {
  // Obtener todos los mensajes donde el admin es el receptor
  const messages = await Message.find({ receiver: req.user._id })
    .sort({ createdAt: -1 });

  // Agrupar mensajes por remitente
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

  // Convertir a array y ordenar por fecha del último mensaje
  const conversationsArray = Object.values(conversations).sort(
    (a, b) => b.lastMessageDate - a.lastMessageDate
  );

  res.json(conversationsArray);
});

// 💬 Obtener conversaciones con usuarios autenticados (admin)
export const getAuthenticatedConversations = asyncHandler(async (req, res) => {
  // Obtener todos los mensajes donde el admin es el receptor y no son públicos
  const messages = await Message.find({
    receiver: req.user._id,
    isPublic: false
  })
    .populate('sender', 'name email role')
    .sort({ createdAt: -1 });

  // Agrupar mensajes por remitente
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

  // Convertir a array y ordenar por fecha del último mensaje
  const conversationsArray = Object.values(conversations).sort(
    (a, b) => b.lastMessageDate - a.lastMessageDate
  );

  res.json(conversationsArray);
});

// 💬 Obtener conversaciones con usuarios no autenticados (admin)
export const getPublicConversations = asyncHandler(async (req, res) => {
  // Obtener todos los mensajes donde el admin es el receptor y son públicos
  const messages = await Message.find({
    receiver: req.user._id,
    isPublic: true
  })
    .sort({ createdAt: -1 });

  // Agrupar mensajes por remitente (publicId)
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

  // Convertir a array y ordenar por fecha del último mensaje
  const conversationsArray = Object.values(conversations).sort(
    (a, b) => b.lastMessageDate - a.lastMessageDate
  );

  res.json(conversationsArray);
});
