import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import crypto from 'crypto';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import createNotification from '../utils/createNotification.js';
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
  const { receiver, text, orderId, name, email, publicId, conversationId: clientConversationId } = req.body;
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  console.log('📨 Datos recibidos en sendMessage:', {
    receiver,
    text,
    orderId,
    name,
    email,
    publicId,
    clientConversationId
  });

  let geoData = null;
  try {
    geoData = await getGeoFromIP(clientIP);
    console.log('🌍 Datos geográficos obtenidos:', geoData);
  } catch (error) {
    console.error('❌ Error obteniendo datos geográficos:', error.message);
  }

  let sender, senderName, isPublic = false, finalReceiver;

  if (req.user) {
    sender = req.user._id;
    senderName = req.user.name;
    console.log('👤 Usuario autenticado:', { sender, senderName, role: req.user.role });

    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      if (!receiver) throw new Error('Se requiere un ID de receptor');

      const isValidMongoId = mongoose.Types.ObjectId.isValid(receiver);
      const isValidPublicId = /^[0-9a-fA-F]{32}$/.test(receiver);

      if (!isValidMongoId && !isValidPublicId) throw new Error('ID de receptor inválido');

      finalReceiver = isValidMongoId ? new mongoose.Types.ObjectId(receiver) : receiver;
      isPublic = isValidPublicId;
    } else if (req.user.role === 'writer') {
      if (!receiver || !mongoose.Types.ObjectId.isValid(receiver)) throw new Error('ID de receptor inválido para writer');

      if (receiver !== DEFAULT_ADMIN_ID && orderId) {
        const order = await Order.findOne({ _id: orderId, writer: req.user._id, client: receiver });
        if (!order) throw new Error('No autorizado para enviar mensaje a este usuario');
      }

      finalReceiver = new mongoose.Types.ObjectId(receiver);
    } else {
      throw new Error('No autorizado');
    }

  } else if (publicId) {
    sender = publicId;
    senderName = name || 'Usuario Anónimo';
    isPublic = true;
    finalReceiver = DEFAULT_ADMIN_ID;
    console.log('👥 Usuario no autenticado con publicId:', sender);
  } else {
    throw new Error('No autorizado: se requiere publicId o autenticación');
  }

  if (!finalReceiver) throw new Error('No se pudo determinar el receptor');

  // Usar el conversationId proporcionado por el cliente si está disponible
  let conversationId;
  if (clientConversationId) {
    console.log('🔄 Usando conversationId proporcionado por el cliente:', clientConversationId);
    conversationId = clientConversationId;
  } else if (isPublic) {
    // Si es público y no hay conversationId del cliente, usar el publicId como conversationId
    conversationId = publicId;
    console.log('🔄 Generando conversationId basado en publicId:', conversationId);
  } else {
    // Conversación directa
    const ids = [sender.toString(), finalReceiver.toString()].sort();
    conversationId = `${ids[0]}_${ids[1]}`;
    console.log('🔄 Generando conversationId compuesto para chat directo:', conversationId);
  }

  console.log('🧩 conversationId generado/utilizado:', conversationId);

  const messageData = {
    sender,
    receiver: finalReceiver,
    orderId: orderId && mongoose.Types.ObjectId.isValid(orderId) ? new mongoose.Types.ObjectId(orderId) : null,
    text,
    isPublic,
    senderName,
    senderIP: clientIP,
    conversationId,
    geoLocation: geoData ? {
      city: geoData.city,
      region: geoData.region,
      country: geoData.country,
      org: geoData.org,
      coordinates: geoData.loc
    } : null,
  };

  if (req.file) {
    messageData.attachment = {
      url: req.file.path,
      fileName: req.file.originalname,
    };
  }

  const newMessage = new Message(messageData);

  const savedMessage = await newMessage.save();
  console.log('💾 Mensaje guardado:', savedMessage);

  if (mongoose.Types.ObjectId.isValid(finalReceiver)) {
    await createNotification(req.app, {
      user: finalReceiver,
      type: 'mensaje',
      message: `Nuevo mensaje de ${senderName}`,
      data: {
        orderId: savedMessage.orderId,
        sender: sender.toString(),
        isPublic,
      },
    });
    console.log('🔔 Notificación creada para:', finalReceiver.toString());
  }

  await savedMessage.populate('sender', 'name role');
  await savedMessage.populate('receiver', 'name role');

  // Emitir evento socket para que los clientes conectados reciban el mensaje en tiempo real
  try {
    const io = req.app.get('io');
    if (io) {
      const msgPayload = savedMessage.toObject();
      if (isPublic) {
        // Mensaje público → emitir al admin y a la sala pública del usuario
        io.to(`public:${sender}`).emit('message', msgPayload);
        io.to(`user:${finalReceiver.toString()}`).emit('message', msgPayload);
        // También emitir a todos los admins conectados (broadcast)
        io.emit('newPublicMessage', msgPayload);
      } else {
        // Mensaje privado → emitir a ambos participantes
        io.to(`user:${sender.toString()}`).emit('message', msgPayload);
        io.to(`user:${finalReceiver.toString()}`).emit('message', msgPayload);
      }
      console.log('📡 Mensaje emitido via socket a destinatarios');
    }
  } catch (socketErr) {
    console.warn('⚠️ Error emitiendo socket (no crítico):', socketErr.message);
  }

  res.status(201).json(savedMessage);
});



// 📬 Obtener mensajes por OrderId o conversación directa
export const getMessagesByOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user?._id;
  const publicId = req.query.publicId || req.headers['x-public-id']; // Aceptar publicId de query o headers

  console.log('Buscando mensajes con:', { orderId, userId, publicId });

  let query = {};

  // Si parece un ID público (hexadecimal de 32 caracteres)
  const looksLikePublicId = /^[0-9a-f]{32}$/.test(orderId);

  if (looksLikePublicId || publicId) {
    const targetPublicId = looksLikePublicId ? orderId : publicId;
    console.log(`Buscando mensajes públicos para ID: ${targetPublicId}`);

    query = {
      $or: [
        { sender: targetPublicId, isPublic: true },
        { receiver: targetPublicId, isPublic: true }
      ]
    };
  } else if (orderId && orderId !== 'null' && mongoose.Types.ObjectId.isValid(orderId)) {
    // Si es un ID de MongoDB válido y el usuario está autenticado
    if (!req.user) {
      res.status(401);
      throw new Error('No autorizado: debes iniciar sesión para acceder a estos mensajes');
    }

    // Verificar acceso al pedido
    const order = await Order.findOne({
      _id: orderId,
      $or: [
        { client: userId },
        { writer: userId }
      ]
    });

    const isAdmin = req.user && req.user.role === 'admin';
    if (!order && !isAdmin) {
      res.status(403);
      throw new Error('No tienes acceso a estos mensajes');
    }

    query = isAdmin
      ? { orderId: new mongoose.Types.ObjectId(orderId) }
      : {
        orderId: new mongoose.Types.ObjectId(orderId),
        $or: [
          { sender: userId },
          { receiver: userId }
        ]
      };
  } else {
    res.status(400);
    throw new Error('Se requiere un ID de pedido válido o un ID público');
  }

  const messages = await Message.find(query)
    .populate('sender', 'name role')
    .populate('receiver', 'name role')
    .sort({ createdAt: 1 });

  console.log(`Se encontraron ${messages.length} mensajes`);
  res.json(messages);
});

// 📬 Obtener mensajes públicos por PublicId
export const getPublicMessagesByPublicId = asyncHandler(async (req, res) => {
  const { publicId } = req.params;

  if (!publicId || typeof publicId !== 'string') {
    res.status(400);
    throw new Error('ID público inválido');
  }

  const messages = await Message.find({
    $or: [
      { sender: publicId, isPublic: true },
      { receiver: publicId, isPublic: true }
    ]
  })
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
  const { id } = req.params;

  // Verificar si el ID es un ObjectId válido o un ID público
  let message;
  if (mongoose.Types.ObjectId.isValid(id)) {
    // Si es un ObjectId válido, buscar por _id
    message = await Message.findById(id);
  } else {
    // Si no es un ObjectId válido, buscar por sender (para IDs públicos)
    message = await Message.findOne({ sender: id });
  }

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
  console.log('🔄 Iniciando getConversations para usuario:', req.user._id);
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  // Consulta mejorada para encontrar todas las conversaciones relevantes
  let query = {
    $or: [
      { receiver: userId },
      { sender: userId }
    ]
  };

  // Si es administrador, incluir también mensajes públicos
  if (isAdmin) {
    query = {
      $or: [
        { receiver: userId },
        { sender: userId },
        { isPublic: true } // Incluir todos los mensajes públicos para el administrador
      ]
    };
    console.log('👑 Usuario es admin, incluyendo mensajes públicos en la consulta');
  }

  console.log('🔍 Consulta para buscar mensajes:', JSON.stringify(query));

  const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .populate('sender', 'name role')
    .populate('receiver', 'name role');

  console.log(`📊 Total de mensajes encontrados para el usuario ${userId}:`, messages.length);

  if (messages.length === 0) {
    console.log('⚠️ No se encontraron mensajes para el usuario');
    return res.json([]);
  }

  // Log de los primeros mensajes para depuración
  console.log('🔍 Muestra de mensajes encontrados:',
    messages.slice(0, Math.min(3, messages.length)).map(m => ({
      id: m._id,
      sender: typeof m.sender === 'object' ? m.sender._id : m.sender,
      receiver: typeof m.receiver === 'object' ? m.receiver._id : m.receiver,
      isPublic: m.isPublic,
      conversationId: m.conversationId,
      text: m.text?.substring(0, 20) + (m.text?.length > 20 ? '...' : '')
    }))
  );

  const conversationsMap = new Map();

  messages.forEach(message => {
    // Asegurar que se utilice el conversationId del mensaje si existe
    let convId = message.conversationId;

    // Si no hay conversationId, generamos uno según las reglas
    if (!convId) {
      if (message.isPublic) {
        // Para mensajes públicos sin conversationId, usar el sender como id
        convId = message.sender?.toString() || message.sender;
        console.log(`⚠️ Mensaje público sin conversationId, usando sender: ${convId}`);
      } else {
        // Para mensajes directos sin conversationId, generar uno basado en sender y receiver
        const senderId = message.sender?._id?.toString() || message.sender?.toString() || message.sender;
        const receiverId = message.receiver?._id?.toString() || message.receiver?.toString() || message.receiver;

        if (senderId && receiverId) {
          const ids = [senderId, receiverId].sort();
          convId = `${ids[0]}_${ids[1]}`;
          console.log(`⚠️ Mensaje directo sin conversationId, generando: ${convId}`);
        }
      }
    }

    if (!convId) {
      console.warn('⚠️ No se pudo determinar conversationId para mensaje:', message._id);
      return; // Saltar mensajes sin conversationId y que no se puede generar uno
    }

    if (!conversationsMap.has(convId)) {
      const isPublic = message.isPublic === true;
      let otherUser = {};

      if (isPublic) {
        // Si el mensaje es público, determinar quién es el visitante
        const senderIsAdmin =
          (typeof message.sender === 'object' && message.sender?.role === 'admin') ||
          message.sender?.toString() === userId.toString();

        if (senderIsAdmin) {
          // Si el admin es el remitente, el "otro usuario" es el receptor
          let receiverId, receiverName;

          if (typeof message.receiver === 'object') {
            receiverId = message.receiver?._id?.toString();
            receiverName = message.receiver?.name || 'Usuario';
          } else {
            receiverId = message.receiver?.toString();
            receiverName = 'Usuario Anónimo';
          }

          otherUser = { id: receiverId, name: receiverName };
        } else {
          // Si el visitante es el remitente, el "otro usuario" es el remitente
          let senderId, senderName;

          if (typeof message.sender === 'object') {
            senderId = message.sender?._id?.toString();
            senderName = message.sender?.name || 'Usuario';
          } else {
            senderId = message.sender?.toString();
            senderName = message.senderName || 'Usuario Anónimo';
          }

          otherUser = { id: senderId, name: senderName };
        }
      } else {
        // Si es mensaje directo, el otro usuario es el que no coincide con userId
        const isSenderCurrentUser =
          (typeof message.sender === 'object' && message.sender?._id?.toString() === userId.toString()) ||
          message.sender?.toString() === userId.toString();

        if (isSenderCurrentUser) {
          if (typeof message.receiver === 'object') {
            otherUser = {
              id: message.receiver?._id?.toString(),
              name: message.receiver?.name || 'Usuario'
            };
          } else {
            otherUser = {
              id: message.receiver?.toString(),
              name: 'Usuario'
            };
          }
        } else {
          if (typeof message.sender === 'object') {
            otherUser = {
              id: message.sender?._id?.toString(),
              name: message.sender?.name || 'Usuario'
            };
          } else {
            otherUser = {
              id: message.sender?.toString(),
              name: message.senderName || 'Usuario'
            };
          }
        }
      }

      console.log(`🔍 Nueva conversación detectada: ${convId}, tipo: ${isPublic ? 'pública' : 'directa'}, usuario: ${otherUser.name}`);

      conversationsMap.set(convId, {
        conversationId: convId,
        senderId: otherUser.id, // Usar el ID determinado
        senderName: otherUser.name, // Usar el nombre determinado
        isPublic,
        lastMessage: message.text,
        lastMessageDate: message.createdAt,
        unreadCount: (message.receiver?.toString() === userId.toString() && !message.isRead) ? 1 : 0,
        status: message.status || 'open',
        messages: [message],
      });
    } else {
      const conv = conversationsMap.get(convId);
      conv.messages.push(message);

      if (message.createdAt > conv.lastMessageDate) {
        conv.lastMessage = message.text;
        conv.lastMessageDate = message.createdAt;
        conv.status = message.status || conv.status;
      }

      // Contar no leídos solo si el receptor es el usuario actual
      if (
        (typeof message.receiver === 'object' && message.receiver?._id?.toString() === userId.toString()) ||
        message.receiver?.toString() === userId.toString()
      ) {
        if (
          (typeof message.sender === 'object' && message.sender?._id?.toString() !== userId.toString()) ||
          (typeof message.sender === 'string' && message.sender !== userId.toString())
        ) {
          if (!message.isRead) {
            conv.unreadCount++;
          }
        }
      }
    }
  });

  const conversations = Array.from(conversationsMap.values())
    .sort((a, b) => new Date(b.lastMessageDate) - new Date(a.lastMessageDate));

  console.log(`🎯 Total de conversaciones generadas: ${conversations.length}`);
  if (conversations.length > 0) {
    console.log('📋 Primera conversación:', {
      id: conversations[0].conversationId,
      sender: conversations[0].senderName,
      isPublic: conversations[0].isPublic,
      lastMessage: conversations[0].lastMessage?.substring(0, 20) + (conversations[0].lastMessage?.length > 20 ? '...' : '')
    });
  }

  res.json(conversations);
});


// 💬 Obtener conversaciones autenticadas
export const getAuthenticatedConversations = asyncHandler(async (req, res) => {
  const messages = await Message.find({
    $or: [
      { receiver: req.user._id, isPublic: false },
      { sender: req.user._id, isPublic: false }
    ]
  })
    .populate('sender', 'name email role')
    .populate('receiver', 'name email role')
    .sort({ createdAt: -1 });

  const conversations = messages.reduce((acc, message) => {
    // Determinar el ID del otro usuario en la conversación
    let senderId;
    if (message.sender._id.toString() === req.user._id.toString()) {
      // Si el remitente es el usuario actual, el otro usuario es el receptor
      senderId = message.receiver._id.toString();
    } else {
      // Si el receptor es el usuario actual, el otro usuario es el remitente
      senderId = message.sender._id.toString();
    }

    if (!acc[senderId]) {
      acc[senderId] = {
        senderId,
        senderName: message.sender._id.toString() === req.user._id.toString() ? message.receiver.name : message.sender.name,
        senderEmail: message.sender._id.toString() === req.user._id.toString() ? message.receiver.email : message.sender.email,
        senderRole: message.sender._id.toString() === req.user._id.toString() ? message.receiver.role : message.sender.role,
        lastMessage: message.text,
        lastMessageDate: message.createdAt,
        unreadCount: message.receiver._id.toString() === req.user._id.toString() && !message.isRead ? 1 : 0,
        messages: [message]
      };
    } else {
      acc[senderId].messages.push(message);
      if (message.receiver._id.toString() === req.user._id.toString() && !message.isRead) {
        acc[senderId].unreadCount++;
      }
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
  const messages = await Message.find({
    $or: [
      { receiver: req.user._id, isPublic: true },
      { sender: req.user._id, isPublic: true }
    ]
  }).sort({ createdAt: -1 });

  const conversations = messages.reduce((acc, message) => {
    // Para mensajes públicos, usar el sender como ID de conversación
    const senderId = message.sender.toString();

    if (!acc[senderId]) {
      acc[senderId] = {
        senderId,
        senderName: message.senderName,
        lastMessage: message.text,
        lastMessageDate: message.createdAt,
        unreadCount: message.receiver.toString() === req.user._id.toString() && !message.isRead ? 1 : 0,
        messages: [message]
      };
    } else {
      acc[senderId].messages.push(message);
      if (message.receiver.toString() === req.user._id.toString() && !message.isRead) {
        acc[senderId].unreadCount++;
      }
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

// 📬 Obtener mensajes directos entre usuarios
export const getDirectMessages = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const currentUserId = req.user._id;

  console.log('📥 Obteniendo mensajes directos entre:', currentUserId, 'y', userId);

  const isMongoId = mongoose.Types.ObjectId.isValid(userId);
  const isPublicId = /^[0-9a-fA-F]{32}$/.test(userId);
  const isConversationId = /^[0-9a-fA-F]{24}-[0-9a-fA-F]{24}$/.test(userId);

  if (!isMongoId && !isPublicId && !isConversationId) {
    throw new Error('ID de usuario inválido');
  }

  let query;
  if (isPublicId) {
    query = {
      $or: [
        { sender: userId, isPublic: true },
        { receiver: currentUserId, sender: userId }
      ]
    };
  } else if (isConversationId) {
    const [userId1, userId2] = userId.split('-');

    if (userId1 !== currentUserId.toString() && userId2 !== currentUserId.toString()) {
      throw new Error('No tienes acceso a esta conversación');
    }

    query = {
      $or: [
        { sender: userId1, receiver: userId2 },
        { sender: userId2, receiver: userId1 }
      ],
      isPublic: false
    };
  } else {
    query = {
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ],
      isPublic: false
    };
  }

  const messages = await Message.find(query)
    .populate('sender', 'name role')
    .populate('receiver', 'name role')
    .sort({ createdAt: 1 });

  console.log(`📊 ${messages.length} mensajes encontrados entre ${currentUserId} y ${userId}`);
  res.json(messages);
});

// ❌ Eliminar conversación completa
export const deleteConversation = asyncHandler(async (req, res) => {
  console.log('🚀 Ejecutando controlador deleteConversation');
  const { conversationId } = req.params;

  console.log(`📄 Parámetros recibidos: conversationId = ${conversationId}`);

  if (!conversationId) {
    console.error('❌ Error: No se proporcionó ID de conversación');
    res.status(400);
    throw new Error('Se requiere ID de conversación');
  }

  // Verificar si es un ID público, un ID de MongoDB o un ID compuesto
  const isPublicId = /^[a-zA-Z0-9]{32}$/.test(conversationId);
  const isMongoId = mongoose.Types.ObjectId.isValid(conversationId);
  const isCompoundId = conversationId.includes('_');

  console.log(`🔍 Tipo de ID: ${isPublicId ? 'Público' : isMongoId ? 'MongoDB' : isCompoundId ? 'Compuesto' : 'Desconocido'}`);

  let query = {};

  if (isPublicId) {
    // Para conversaciones públicas, eliminar mensajes con ese conversationId
    query = { conversationId };
    console.log('🔍 Consulta para ID público:', query);
  } else if (isCompoundId) {
    // Para conversaciones directas, eliminar mensajes entre esos dos usuarios
    query = { conversationId };
    console.log('🔍 Consulta para ID compuesto:', query);
  } else if (isMongoId) {
    // Para IDs de MongoDB (por ejemplo, IDs de conversación generados automáticamente)
    query = {
      $or: [
        { conversationId },
        { _id: new mongoose.Types.ObjectId(conversationId) }
      ]
    };
    console.log('🔍 Consulta para ID de MongoDB:', query);
  } else {
    console.error('❌ Error: Formato de ID inválido');
    res.status(400);
    throw new Error('Formato de ID de conversación inválido');
  }

  console.log(`🗑️ Eliminando conversación: ${conversationId} con query:`, query);

  try {
    // Eliminar todos los mensajes que coincidan con la consulta
    const result = await Message.deleteMany(query);
    console.log(`✅ Resultado de eliminación:`, result);

    if (result.deletedCount === 0) {
      console.warn('⚠️ No se encontraron mensajes para eliminar');
      res.status(404);
      throw new Error('No se encontraron mensajes para eliminar');
    }

    console.log(`🎉 Éxito: Se eliminaron ${result.deletedCount} mensajes`);

    res.json({
      message: `Conversación eliminada exitosamente. ${result.deletedCount} mensajes eliminados.`,
      deletedCount: result.deletedCount,
      conversationId
    });
  } catch (error) {
    console.error('❌ Error durante la eliminación:', error);
    throw error;
  }
});
