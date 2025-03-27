import asyncHandler from 'express-async-handler';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';

// 📤 Enviar mensaje (con o sin archivo)
export const sendMessage = asyncHandler(async (req, res) => {
  const { receiver, text, orderId } = req.body;
  const sender = req.user._id;

  const newMessage = new Message({
    sender,
    receiver,
    orderId: orderId || null,
    text,
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
    user: receiver,
    type: 'mensaje',
    message: `Nuevo mensaje de ${req.user.name}`,
    data: {
      orderId,
      sender: sender.toString(),
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
