import Message from '../models/Message.js';
import Notification from '../models/Notification.js';

export const chatSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('🟢 Usuario conectado al chat:', socket.id);

    // 👉 Unirse a una sala de pedido
    socket.on('joinOrderChat', (orderId) => {
      socket.join(orderId);
      console.log(`🧩 Usuario se unió al chat del pedido ${orderId}`);
    });

    // 👉 Enviar mensaje en tiempo real
    socket.on('sendMessage', async (data) => {
      try {
        console.log('Datos recibidos:', data);
        const { text, receiver, attachment, publicId, name } = data;

        // Determinar el sender y receiver
        const sender = socket.user._id;
        const senderName = socket.user.isPublic ? (name || 'Usuario Anónimo') : socket.user.name;

        // Para usuarios públicos, el receiver es el ID del admin
        const finalReceiver = socket.user.isPublic ? process.env.DEFAULT_ADMIN_ID : receiver;

        if (!finalReceiver) {
          console.error('Error: No se pudo determinar el receptor');
          socket.emit('error', { message: 'No se pudo determinar el receptor del mensaje' });
          return;
        }

        console.log('Creando mensaje con:', {
          sender,
          receiver: finalReceiver,
          text,
          isPublic: socket.user.isPublic,
          senderName,
          orderId: data.orderId || null
        });

        // Create new message
        const newMessage = await Message.create({
          sender,
          receiver: finalReceiver,
          orderId: data.orderId || null,
          text,
          attachment,
          isPublic: socket.user.isPublic,
          senderName,
          isRead: false
        });

        // Create notification for the receiver
        await Notification.create({
          user: finalReceiver,
          type: 'mensaje',
          message: `Nuevo mensaje de ${senderName}`,
          data: {
            orderId: data.orderId || null,
            sender: sender.toString(),
            isPublic: socket.user.isPublic,
          },
        });

        // Si el usuario es autenticado, poblar la información del sender
        if (!socket.user.isPublic) {
          await newMessage.populate('sender', 'name email');
        }

        // Emitir el mensaje a las salas correspondientes
        if (data.orderId) {
          // Para mensajes de pedidos
          io.to(data.orderId).emit('newMessage', newMessage);
          console.log(`📤 Mensaje enviado en la sala ${data.orderId}`);
        } else if (socket.user.isPublic) {
          // Para mensajes públicos
          io.to(`public:${sender}`).emit('newMessage', newMessage); // Enviar al usuario público
          io.to(`user:${finalReceiver}`).emit('newMessage', newMessage); // Enviar al admin
          console.log(`📤 Mensaje público enviado entre ${sender} y ${finalReceiver}`);
        } else {
          // Para mensajes directos
          io.to(`user:${sender}`).emit('newMessage', newMessage);
          io.to(`user:${finalReceiver}`).emit('newMessage', newMessage);
          console.log(`📤 Mensaje directo enviado entre ${sender} y ${finalReceiver}`);
        }

        // Emitir notificación al receptor
        io.to(`notifications:${finalReceiver}`).emit('newNotification', {
          type: 'mensaje',
          message: `Nuevo mensaje de ${senderName}`,
          data: {
            orderId: data.orderId || null,
            sender: sender.toString(),
            isPublic: socket.user.isPublic,
          },
        });
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Error al enviar el mensaje' });
      }
    });

    // 👉 Marcar mensaje como leído
    socket.on('markAsRead', async (messageId) => {
      try {
        const message = await Message.findById(messageId);

        if (!message) {
          socket.emit('error', { message: 'Mensaje no encontrado' });
          return;
        }

        // Verificar si el usuario es el receptor
        if (message.receiver.toString() !== socket.user._id.toString()) {
          socket.emit('error', { message: 'No autorizado' });
          return;
        }

        message.isRead = true;
        await message.save();

        // Notificar al remitente que el mensaje fue leído
        if (message.isPublic) {
          io.to(`public:${message.sender}`).emit('messageRead', { messageId });
        } else {
          io.to(`user:${message.sender}`).emit('messageRead', { messageId });
        }

        console.log(`📖 Mensaje ${messageId} marcado como leído`);
      } catch (error) {
        console.error('Error marking message as read:', error);
        socket.emit('error', { message: 'Error al marcar como leído' });
      }
    });

    // 👉 Indicador de escritura
    socket.on('typing', (data) => {
      const { orderId, isTyping } = data;
      if (orderId) {
        socket.to(orderId).emit('userTyping', {
          userId: socket.user._id,
          name: socket.user.name,
          isTyping
        });
      }
    });

    // 👉 Desconexión
    socket.on('disconnect', () => {
      console.log('🔴 Usuario desconectado del chat:', socket.id);
    });
  });
};
