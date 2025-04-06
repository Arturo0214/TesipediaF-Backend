import Message from '../models/Message.js';

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
        const senderName = socket.user.isPublic ? 'Usuario Anónimo' : socket.user.name;

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

        // Si el usuario es autenticado, poblar la información del sender
        if (!socket.user.isPublic) {
          await newMessage.populate('sender', 'name email');
        }

        // Emitir el mensaje a la sala correspondiente
        if (data.orderId) {
          io.to(data.orderId).emit('newMessage', newMessage);
          console.log(`📤 Mensaje enviado en la sala ${data.orderId}`);
        } else {
          // Para mensajes públicos, emitir al admin
          io.to(`user:${finalReceiver}`).emit('newMessage', newMessage);
          console.log(`📤 Mensaje público enviado al admin ${finalReceiver}`);
        }
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
        io.to(message.receiver.toString()).emit('messageRead', { messageId });

        console.log(`📖 Mensaje ${messageId} marcado como leído`);
      } catch (error) {
        console.error('Error marking message as read:', error);
        socket.emit('error', { message: 'Error al marcar como leído' });
      }
    });

    // 👉 Indicador de escritura
    socket.on('typing', (data) => {
      const { orderId, isTyping } = data;
      socket.to(orderId).emit('userTyping', {
        userId: socket.user._id,
        name: socket.user.name,
        isTyping
      });
    });

    // 👉 Desconexión
    socket.on('disconnect', () => {
      console.log('🔴 Usuario desconectado del chat:', socket.id);
    });
  });
};
