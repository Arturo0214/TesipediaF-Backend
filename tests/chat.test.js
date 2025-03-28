import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    generatePublicId,
    sendMessage,
    getMessagesByOrder,
    markMessagesAsRead,
    getMessages,
    getMessageById,
    updateMessage,
    deleteMessage,
    searchMessages,
    markAsRead,
    getConversations,
    getAuthenticatedConversations,
} from '../controllers/chatController.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';

// Mock de los modelos
jest.mock('../models/Message.js');
jest.mock('../models/Notification.js');
jest.mock('../models/User.js');

describe('Chat Controller', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            body: {},
            params: {},
            user: {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                role: 'user',
            },
            file: null,
        };
        mockRes = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis(),
        };
        mockNext = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('generatePublicId', () => {
        it('should generate a public id', async () => {
            await generatePublicId(mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({
                publicId: expect.any(String),
                message: 'ID público generado exitosamente'
            });
        });
    });

    describe('sendMessage', () => {
        it('should send a message from authenticated user', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                sender: mockReq.user._id,
                receiver: new mongoose.Types.ObjectId(),
                text: 'Test message',
                isPublic: false,
                senderName: 'Test User',
            };

            mockReq.body = {
                receiver: mockMessage.receiver.toString(),
                text: 'Test message',
            };

            Message.prototype.save = jest.fn().mockResolvedValue(mockMessage);
            Notification.create = jest.fn().mockResolvedValue({});

            await sendMessage(mockReq, mockRes);
            expect(Message.prototype.save).toHaveBeenCalled();
            expect(Notification.create).toHaveBeenCalledWith({
                user: mockMessage.receiver,
                type: 'mensaje',
                message: expect.stringContaining('Nuevo mensaje de Test User'),
                data: {
                    orderId: null,
                    sender: mockReq.user._id.toString(),
                    isPublic: false,
                },
            });
            expect(mockRes.status(201).json).toHaveBeenCalledWith(mockMessage);
        });

        it('should send a message from public user', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                sender: 'test-public-id',
                receiver: new mongoose.Types.ObjectId(),
                text: 'Test message',
                isPublic: true,
                senderName: 'Anonymous User',
            };

            mockReq.user = null;
            mockReq.body = {
                receiver: mockMessage.receiver.toString(),
                text: 'Test message',
                publicId: 'test-public-id',
                name: 'Anonymous User',
            };

            Message.prototype.save = jest.fn().mockResolvedValue(mockMessage);
            Notification.create = jest.fn().mockResolvedValue({});

            await sendMessage(mockReq, mockRes);
            expect(Message.prototype.save).toHaveBeenCalled();
            expect(Notification.create).toHaveBeenCalledWith({
                user: mockMessage.receiver,
                type: 'mensaje',
                message: expect.stringContaining('Nuevo mensaje de Anonymous User'),
                data: {
                    orderId: null,
                    sender: 'test-public-id',
                    isPublic: true,
                },
            });
            expect(mockRes.status(201).json).toHaveBeenCalledWith(mockMessage);
        });

        it('should send a message with attachment', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                sender: mockReq.user._id,
                receiver: new mongoose.Types.ObjectId(),
                text: 'Test message',
                isPublic: false,
                senderName: 'Test User',
            };

            mockReq.body = {
                receiver: mockMessage.receiver.toString(),
                text: 'Test message',
            };

            mockReq.file = {
                path: 'test/path/file.pdf',
                originalname: 'file.pdf',
            };

            Message.prototype.save = jest.fn().mockResolvedValue(mockMessage);
            Notification.create = jest.fn().mockResolvedValue({});

            await sendMessage(mockReq, mockRes);
            expect(Message.prototype.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    attachment: {
                        url: 'test/path/file.pdf',
                        fileName: 'file.pdf',
                    },
                })
            );
        });

        it('should return error if receiver id is invalid', async () => {
            mockReq.body = {
                receiver: 'invalid-id',
                text: 'Test message',
            };

            await sendMessage(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'ID de receptor no válido'
            });
        });

        it('should return error if public id is missing for unauthenticated user', async () => {
            mockReq.user = null;
            mockReq.body = {
                receiver: new mongoose.Types.ObjectId().toString(),
                text: 'Test message',
            };

            await sendMessage(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Se requiere un identificador público para enviar mensajes sin autenticación'
            });
        });
    });

    describe('getMessagesByOrder', () => {
        it('should get messages by order id', async () => {
            const mockMessages = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    sender: mockReq.user._id,
                    receiver: new mongoose.Types.ObjectId(),
                    text: 'Test message',
                    orderId: new mongoose.Types.ObjectId(),
                    createdAt: new Date(),
                },
            ];

            mockReq.params.orderId = mockMessages[0].orderId.toString();

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockReturnValue({
                        sort: jest.fn().mockResolvedValue(mockMessages),
                    }),
                }),
            };

            Message.find = jest.fn().mockReturnValue(mockQuery);

            await getMessagesByOrder(mockReq, mockRes);
            expect(Message.find).toHaveBeenCalledWith({ orderId: mockMessages[0].orderId });
            expect(mockQuery.populate).toHaveBeenCalledWith('sender', 'name role');
            expect(mockQuery.populate().populate).toHaveBeenCalledWith('receiver', 'name role');
            expect(mockQuery.populate().populate().sort).toHaveBeenCalledWith({ createdAt: 1 });
            expect(mockRes.json).toHaveBeenCalledWith(mockMessages);
        });
    });

    describe('markMessagesAsRead', () => {
        it('should mark messages as read', async () => {
            const orderId = new mongoose.Types.ObjectId();
            mockReq.params.orderId = orderId.toString();

            Message.updateMany = jest.fn().mockResolvedValue({});

            await markMessagesAsRead(mockReq, mockRes);
            expect(Message.updateMany).toHaveBeenCalledWith(
                { orderId, receiver: mockReq.user._id, isRead: false },
                { $set: { isRead: true } }
            );
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Mensajes marcados como leídos'
            });
        });
    });

    describe('getMessages', () => {
        it('should get all messages', async () => {
            const mockMessages = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    sender: mockReq.user._id,
                    receiver: new mongoose.Types.ObjectId(),
                    text: 'Test message',
                    createdAt: new Date(),
                },
            ];

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockReturnValue({
                        sort: jest.fn().mockResolvedValue(mockMessages),
                    }),
                }),
            };

            Message.find = jest.fn().mockReturnValue(mockQuery);

            await getMessages(mockReq, mockRes);
            expect(Message.find).toHaveBeenCalledWith({});
            expect(mockQuery.populate).toHaveBeenCalledWith('sender', 'name email role');
            expect(mockQuery.populate().populate).toHaveBeenCalledWith('receiver', 'name email role');
            expect(mockQuery.populate().populate().sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockRes.json).toHaveBeenCalledWith(mockMessages);
        });
    });

    describe('getMessageById', () => {
        it('should get message by id', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                sender: mockReq.user._id,
                receiver: new mongoose.Types.ObjectId(),
                text: 'Test message',
            };

            mockReq.params.id = mockMessage._id.toString();

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(mockMessage),
                }),
            };

            Message.findById = jest.fn().mockReturnValue(mockQuery);

            await getMessageById(mockReq, mockRes);
            expect(Message.findById).toHaveBeenCalledWith(mockMessage._id);
            expect(mockQuery.populate).toHaveBeenCalledWith('sender', 'name email role');
            expect(mockQuery.populate().populate).toHaveBeenCalledWith('receiver', 'name email role');
            expect(mockRes.json).toHaveBeenCalledWith(mockMessage);
        });

        it('should return error if message not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(null),
                }),
            };

            Message.findById = jest.fn().mockReturnValue(mockQuery);

            await getMessageById(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Mensaje no encontrado'
            });
        });
    });

    describe('updateMessage', () => {
        it('should update message', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                text: 'Original message',
                isRead: false,
                save: jest.fn().mockResolvedValue({
                    _id: mockMessage._id,
                    text: 'Updated message',
                    isRead: true,
                }),
            };

            mockReq.params.id = mockMessage._id.toString();
            mockReq.body = {
                text: 'Updated message',
                isRead: true,
            };

            Message.findById = jest.fn().mockResolvedValue(mockMessage);

            await updateMessage(mockReq, mockRes);
            expect(Message.findById).toHaveBeenCalledWith(mockMessage._id);
            expect(mockMessage.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    text: 'Updated message',
                    isRead: true,
                })
            );
        });

        it('should return error if message not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body = {
                text: 'Updated message',
                isRead: true,
            };

            Message.findById = jest.fn().mockResolvedValue(null);

            await updateMessage(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Mensaje no encontrado'
            });
        });
    });

    describe('deleteMessage', () => {
        it('should delete message', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                deleteOne: jest.fn().mockResolvedValue({}),
            };

            mockReq.params.id = mockMessage._id.toString();

            Message.findById = jest.fn().mockResolvedValue(mockMessage);

            await deleteMessage(mockReq, mockRes);
            expect(Message.findById).toHaveBeenCalledWith(mockMessage._id);
            expect(mockMessage.deleteOne).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Mensaje eliminado correctamente'
            });
        });

        it('should return error if message not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            Message.findById = jest.fn().mockResolvedValue(null);

            await deleteMessage(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Mensaje no encontrado'
            });
        });
    });

    describe('searchMessages', () => {
        it('should search messages', async () => {
            const mockMessages = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    text: 'Test message',
                    attachment: {
                        fileName: 'test.pdf',
                    },
                },
            ];

            mockReq.query.query = 'test';

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockReturnValue({
                        sort: jest.fn().mockResolvedValue(mockMessages),
                    }),
                }),
            };

            Message.find = jest.fn().mockReturnValue(mockQuery);

            await searchMessages(mockReq, mockRes);
            expect(Message.find).toHaveBeenCalledWith({
                $or: [
                    { text: { $regex: 'test', $options: 'i' } },
                    { 'attachment.fileName': { $regex: 'test', $options: 'i' } },
                ],
            });
            expect(mockQuery.populate).toHaveBeenCalledWith('sender', 'name email role');
            expect(mockQuery.populate().populate).toHaveBeenCalledWith('receiver', 'name email role');
            expect(mockQuery.populate().populate().sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockRes.json).toHaveBeenCalledWith(mockMessages);
        });
    });

    describe('markAsRead', () => {
        it('should mark message as read', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                receiver: mockReq.user._id,
                isRead: false,
                save: jest.fn().mockResolvedValue({
                    _id: mockMessage._id,
                    isRead: true,
                }),
            };

            mockReq.params.id = mockMessage._id.toString();

            Message.findById = jest.fn().mockResolvedValue(mockMessage);

            await markAsRead(mockReq, mockRes);
            expect(Message.findById).toHaveBeenCalledWith(mockMessage._id);
            expect(mockMessage.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Mensaje marcado como leído',
                message: expect.any(Object),
            });
        });

        it('should return error if message not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            Message.findById = jest.fn().mockResolvedValue(null);

            await markAsRead(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Mensaje no encontrado'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockMessage = {
                _id: new mongoose.Types.ObjectId(),
                receiver: new mongoose.Types.ObjectId(), // Different user
            };

            mockReq.params.id = mockMessage._id.toString();

            Message.findById = jest.fn().mockResolvedValue(mockMessage);

            await markAsRead(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado para marcar este mensaje como leído'
            });
        });
    });

    describe('getConversations', () => {
        it('should get all conversations', async () => {
            const mockMessages = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    sender: new mongoose.Types.ObjectId(),
                    senderName: 'Test User',
                    isPublic: false,
                    text: 'Test message',
                    createdAt: new Date(),
                    isRead: false,
                },
            ];

            Message.find = jest.fn().mockReturnValue({
                sort: jest.fn().mockResolvedValue(mockMessages),
            });

            await getConversations(mockReq, mockRes);
            expect(Message.find).toHaveBeenCalledWith({ receiver: mockReq.user._id });
            expect(Message.find().sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        senderId: expect.any(String),
                        senderName: 'Test User',
                        isPublic: false,
                        lastMessage: 'Test message',
                        lastMessageDate: expect.any(Date),
                        unreadCount: 1,
                        messages: expect.any(Array),
                    }),
                ])
            );
        });
    });

    describe('getAuthenticatedConversations', () => {
        it('should get authenticated conversations', async () => {
            const mockMessages = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    sender: {
                        _id: new mongoose.Types.ObjectId(),
                        name: 'Test User',
                        email: 'test@example.com',
                        role: 'user',
                    },
                    text: 'Test message',
                    createdAt: new Date(),
                    isRead: false,
                },
            ];

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    sort: jest.fn().mockResolvedValue(mockMessages),
                }),
            };

            Message.find = jest.fn().mockReturnValue(mockQuery);

            await getAuthenticatedConversations(mockReq, mockRes);
            expect(Message.find).toHaveBeenCalledWith({
                receiver: mockReq.user._id,
                isPublic: false,
            });
            expect(mockQuery.populate).toHaveBeenCalledWith('sender', 'name email role');
            expect(mockQuery.populate().sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        senderId: expect.any(String),
                        senderName: 'Test User',
                        isPublic: false,
                        lastMessage: 'Test message',
                        lastMessageDate: expect.any(Date),
                        unreadCount: 1,
                        messages: expect.any(Array),
                    }),
                ])
            );
        });
    });
}); 