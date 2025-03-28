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
        const { sender, receiver, orderId, text, attachment } = data;

        // Create new message
        const newMessage = await Message.create({
          sender,
          receiver,
          orderId,
          text,
          attachment,
          isRead: false
        });

        // Populate sender information
        await newMessage.populate('sender', 'name email');

        // Emit to specific room based on orderId or direct message
        const room = orderId || `direct:${[sender, receiver].sort().join(':')}`;
        io.to(room).emit('newMessage', newMessage);

        // Emit to receiver's personal room for notifications
        io.to(`user:${receiver}`).emit('messageReceived', newMessage);

        console.log(`📤 Mensaje enviado en la sala ${room}`);
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Error sending message' });
      }
    });

    // 👉 Marcar mensaje como leído
    socket.on('markAsRead', async (messageId) => {
      try {
        const message = await Message.findById(messageId);

        if (!message) {
          socket.emit('error', { message: 'Message not found' });
          return;
        }

        // Verify the user is the receiver
        if (message.receiver.toString() !== socket.user._id.toString()) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        message.isRead = true;
        await message.save();

        // Notify sender that message was read
        const room = message.orderId || `direct:${[message.sender, message.receiver].sort().join(':')}`;
        io.to(room).emit('messageRead', { messageId });

        console.log(`📖 Mensaje ${messageId} marcado como leído`);
      } catch (error) {
        console.error('Error marking message as read:', error);
        socket.emit('error', { message: 'Error marking message as read' });
      }
    });

    // 👉 Indicador de escritura
    socket.on('typing', (data) => {
      const { orderId, isTyping } = data;
      socket.to(orderId).emit('userTyping', {
        userId: socket.user._id,
        isTyping
      });
    });

    // 👉 Desconexión
    socket.on('disconnect', () => {
      console.log('🔴 Usuario desconectado del chat:', socket.id);
    });
  });
};
