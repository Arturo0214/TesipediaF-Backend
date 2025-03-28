import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    createOrder,
    createOrderFromQuote,
    getMyOrders,
    getOrders,
    getOrderById,
    getOrderByIdAdmin,
    updateOrder,
    deleteOrder,
    searchOrders,
    markAsPaid,
} from '../controllers/orderController.js';
import Order from '../models/Order.js';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import calculatePrice from '../utils/calculatePrice.js';

// Mock de los modelos
jest.mock('../models/Order.js');
jest.mock('../models/Quote.js');
jest.mock('../models/Notification.js');
jest.mock('../utils/calculatePrice.js');

describe('Order Controller', () => {
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
        };
        mockRes = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis(),
        };
        mockNext = jest.fn();
        calculatePrice.mockReturnValue(100);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createOrder', () => {
        it('should create a new order', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: mockReq.user._id,
                title: 'Test Order',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                pages: 10,
                dueDate: new Date(),
                price: 100,
            };

            Order.create = jest.fn().mockResolvedValue(mockOrder);
            Notification.create = jest.fn().mockResolvedValue({});

            mockReq.body = {
                title: 'Test Order',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                pages: 10,
                dueDate: new Date(),
            };

            await createOrder(mockReq, mockRes);
            expect(calculatePrice).toHaveBeenCalledWith('Test Area', 'Test Level', 10);
            expect(Order.create).toHaveBeenCalledWith({
                user: mockReq.user._id,
                title: 'Test Order',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                pages: 10,
                dueDate: expect.any(Date),
                price: 100,
                quoteId: null,
            });
            expect(Notification.create).toHaveBeenCalledWith({
                user: process.env.SUPER_ADMIN_ID,
                type: 'pedido',
                message: expect.stringContaining('Nuevo pedido manual creado'),
                data: {
                    orderId: mockOrder._id,
                    userId: mockReq.user._id,
                },
            });
            expect(mockRes.status(201).json).toHaveBeenCalledWith(mockOrder);
        });

        it('should return error if required fields are missing', async () => {
            mockReq.body = {
                title: 'Test Order',
            };

            await createOrder(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Faltan campos obligatorios'
            });
        });
    });

    describe('createOrderFromQuote', () => {
        it('should create order from quote', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                publicId: 'test-quote',
                user: mockReq.user._id,
                taskTitle: 'Test Task',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                pages: 10,
                dueDate: new Date(),
                convertedToOrder: false,
                save: jest.fn().mockResolvedValue({}),
            };

            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: mockReq.user._id,
                title: 'Test Task',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                pages: 10,
                dueDate: new Date(),
                price: 100,
                quoteId: mockQuote._id,
            };

            Quote.findOne = jest.fn().mockResolvedValue(mockQuote);
            Order.create = jest.fn().mockResolvedValue(mockOrder);
            Notification.create = jest.fn().mockResolvedValue({});

            mockReq.params.publicId = 'test-quote';

            await createOrderFromQuote(mockReq, mockRes);
            expect(Quote.findOne).toHaveBeenCalledWith({ publicId: 'test-quote' });
            expect(calculatePrice).toHaveBeenCalledWith('Test Area', 'Test Level', 10);
            expect(Order.create).toHaveBeenCalledWith({
                user: mockReq.user._id,
                title: 'Test Task',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                pages: 10,
                dueDate: expect.any(Date),
                price: 100,
                quoteId: mockQuote._id,
            });
            expect(mockQuote.save).toHaveBeenCalled();
            expect(Notification.create).toHaveBeenCalledWith({
                user: process.env.SUPER_ADMIN_ID,
                type: 'pedido',
                message: expect.stringContaining('Pedido creado desde cotización'),
                data: {
                    orderId: mockOrder._id,
                    quoteId: mockQuote._id,
                    userId: mockReq.user._id,
                },
            });
            expect(mockRes.status(201).json).toHaveBeenCalledWith({
                message: 'Pedido creado a partir de cotización',
                order: mockOrder,
            });
        });

        it('should return error if quote not found', async () => {
            Quote.findOne = jest.fn().mockResolvedValue(null);

            mockReq.params.publicId = 'nonexistent-quote';

            await createOrderFromQuote(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización no encontrada'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                publicId: 'test-quote',
                user: new mongoose.Types.ObjectId(), // Different user
            };

            Quote.findOne = jest.fn().mockResolvedValue(mockQuote);

            mockReq.params.publicId = 'test-quote';

            await createOrderFromQuote(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado para convertir esta cotización'
            });
        });

        it('should return error if quote already converted', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                publicId: 'test-quote',
                user: mockReq.user._id,
                convertedToOrder: true,
            };

            Quote.findOne = jest.fn().mockResolvedValue(mockQuote);

            mockReq.params.publicId = 'test-quote';

            await createOrderFromQuote(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Esta cotización ya fue convertida en pedido'
            });
        });
    });

    describe('getMyOrders', () => {
        it('should get user orders', async () => {
            const mockOrders = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    user: mockReq.user._id,
                    title: 'Test Order',
                    status: 'pending',
                },
            ];

            Order.find = jest.fn().mockResolvedValue(mockOrders);

            await getMyOrders(mockReq, mockRes);
            expect(Order.find).toHaveBeenCalledWith({ user: mockReq.user._id });
            expect(mockRes.json).toHaveBeenCalledWith(mockOrders);
        });
    });

    describe('getOrders', () => {
        it('should get all orders for admin', async () => {
            const mockOrders = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    user: new mongoose.Types.ObjectId(),
                    title: 'Test Order',
                    status: 'pending',
                },
            ];

            mockReq.user.role = 'admin';
            Order.find = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockOrders),
            });

            await getOrders(mockReq, mockRes);
            expect(Order.find).toHaveBeenCalledWith({});
            expect(mockRes.json).toHaveBeenCalledWith(mockOrders);
        });
    });

    describe('getOrderById', () => {
        it('should get order by id for owner', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: mockReq.user._id,
                title: 'Test Order',
                status: 'pending',
            };

            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockOrder),
            });

            mockReq.params.id = mockOrder._id.toString();

            await getOrderById(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockRes.json).toHaveBeenCalledWith(mockOrder);
        });

        it('should get order by id for admin', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                status: 'pending',
            };

            mockReq.user.role = 'admin';
            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockOrder),
            });

            mockReq.params.id = mockOrder._id.toString();

            await getOrderById(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockRes.json).toHaveBeenCalledWith(mockOrder);
        });

        it('should return error if order not found', async () => {
            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(null),
            });

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await getOrderById(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: new mongoose.Types.ObjectId(), // Different user
                title: 'Test Order',
                status: 'pending',
            };

            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockOrder),
            });

            mockReq.params.id = mockOrder._id.toString();

            await getOrderById(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Acceso no autorizado'
            });
        });
    });

    describe('getOrderByIdAdmin', () => {
        it('should get order by id for admin', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                status: 'pending',
            };

            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockOrder),
            });

            mockReq.params.id = mockOrder._id.toString();

            await getOrderByIdAdmin(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockRes.json).toHaveBeenCalledWith(mockOrder);
        });

        it('should return error if order not found', async () => {
            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(null),
            });

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await getOrderByIdAdmin(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });
    });

    describe('updateOrder', () => {
        it('should update order', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                pages: 10,
                dueDate: new Date(),
                status: 'pending',
                price: 100,
                save: jest.fn().mockResolvedValue({
                    _id: mockOrder._id,
                    title: 'Updated Order',
                    status: 'processing',
                }),
            };

            Order.findById = jest.fn().mockResolvedValue(mockOrder);

            mockReq.params.id = mockOrder._id.toString();
            mockReq.body = {
                title: 'Updated Order',
                status: 'processing',
            };

            await updateOrder(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockOrder.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    title: 'Updated Order',
                    status: 'processing',
                })
            );
        });

        it('should return error if order not found', async () => {
            Order.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body = {
                title: 'Updated Order',
                status: 'processing',
            };

            await updateOrder(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });
    });

    describe('deleteOrder', () => {
        it('should delete order', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                deleteOne: jest.fn().mockResolvedValue({}),
            };

            Order.findById = jest.fn().mockResolvedValue(mockOrder);

            mockReq.params.id = mockOrder._id.toString();

            await deleteOrder(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockOrder.deleteOne).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido eliminado correctamente'
            });
        });

        it('should return error if order not found', async () => {
            Order.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await deleteOrder(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });
    });

    describe('searchOrders', () => {
        it('should search orders', async () => {
            const mockOrders = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    title: 'Test Order',
                    studyArea: 'Test Area',
                    status: 'pending',
                },
            ];

            const mockQuery = {
                populate: jest.fn().mockResolvedValue(mockOrders),
            };

            Order.find = jest.fn().mockReturnValue(mockQuery);

            mockReq.query.query = 'test';

            await searchOrders(mockReq, mockRes);
            expect(Order.find).toHaveBeenCalledWith({
                $or: [
                    { title: { $regex: 'test', $options: 'i' } },
                    { studyArea: { $regex: 'test', $options: 'i' } },
                    { status: { $regex: 'test', $options: 'i' } },
                ],
            });
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(mockRes.json).toHaveBeenCalledWith(mockOrders);
        });
    });

    describe('markAsPaid', () => {
        it('should mark order as paid', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: mockReq.user._id,
                status: 'pendiente',
                isPaid: false,
                save: jest.fn().mockResolvedValue({
                    _id: mockOrder._id,
                    isPaid: true,
                    status: 'en progreso',
                }),
            };

            Order.findById = jest.fn().mockResolvedValue(mockOrder);
            Notification.create = jest.fn().mockResolvedValue({});

            mockReq.params.id = mockOrder._id.toString();

            await markAsPaid(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockOrder.save).toHaveBeenCalled();
            expect(Notification.create).toHaveBeenCalledWith({
                user: process.env.SUPER_ADMIN_ID,
                type: 'pago',
                message: expect.stringContaining('marcado como pagado'),
                data: {
                    orderId: mockOrder._id,
                    userId: mockReq.user._id,
                },
            });
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido marcado como pagado',
                order: expect.any(Object),
            });
        });

        it('should return error if order not found', async () => {
            Order.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await markAsPaid(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                user: new mongoose.Types.ObjectId(), // Different user
            };

            Order.findById = jest.fn().mockResolvedValue(mockOrder);

            mockReq.params.id = mockOrder._id.toString();

            await markAsPaid(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado para marcar este pedido como pagado'
            });
        });
    });
}); 