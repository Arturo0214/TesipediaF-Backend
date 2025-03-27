import Message from '../models/Message.js';

export const chatSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('🟢 Usuario conectado al chat:', socket.id);

    // 👉 Unirse a una sala de pedido
    socket.on('joinOrderChat', (orderId) => {
      socket.join(orderId);
      console.log(`🧩 Usuario se unió al chat del pedido ${orderId}`);
    });

    // 📤 Enviar mensaje en tiempo real
    socket.on('sendMessage', async (data) => {
      const { sender, receiver, orderId, text } = data;

      const newMessage = await Message.create({
        sender,
        receiver,
        orderId,
        text,
      });

      io.to(orderId).emit('newMessage', newMessage);
    });

    socket.on('disconnect', () => {
      console.log('🔴 Usuario desconectado del chat:', socket.id);
    });
  });
};
