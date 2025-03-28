import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    getAllUsers,
    deleteUser,
    toggleActiveStatus,
    getAllOrders,
    assignOrderToWriter,
    getStats,
    getAllVisits,
    getDashboard,
    searchAdmin,
    getOrderById,
    updateOrder,
} from '../controllers/adminController.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Quote from '../models/Quote.js';
import Visit from '../models/Visit.js';

// Mock de los modelos
jest.mock('../models/User.js');
jest.mock('../models/Order.js');
jest.mock('../models/Quote.js');
jest.mock('../models/Visit.js');

describe('Admin Controller', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            params: {},
            body: {},
            query: {},
            user: {
                _id: new mongoose.Types.ObjectId(),
                role: 'admin',
            },
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

    describe('getAllUsers', () => {
        it('should get all users', async () => {
            const mockUsers = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test User',
                    email: 'test@example.com',
                    role: 'user',
                },
            ];

            User.find = jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue(mockUsers),
            });

            await getAllUsers(mockReq, mockRes);
            expect(User.find).toHaveBeenCalledWith({});
            expect(User.find().select).toHaveBeenCalledWith('-password');
            expect(mockRes.json).toHaveBeenCalledWith(mockUsers);
        });
    });

    describe('deleteUser', () => {
        it('should delete user', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
                deleteOne: jest.fn().mockResolvedValue({}),
            };

            mockReq.params.id = mockUser._id.toString();

            User.findById = jest.fn().mockResolvedValue(mockUser);

            await deleteUser(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockUser._id);
            expect(mockUser.deleteOne).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario eliminado correctamente'
            });
        });

        it('should return error if user not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            User.findById = jest.fn().mockResolvedValue(null);

            await deleteUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });

        it('should return error if trying to delete admin', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test Admin',
                email: 'admin@example.com',
                role: 'admin',
            };

            mockReq.params.id = mockUser._id.toString();

            User.findById = jest.fn().mockResolvedValue(mockUser);

            await deleteUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No puedes eliminar a otro administrador'
            });
        });
    });

    describe('toggleActiveStatus', () => {
        it('should toggle user active status', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                isActive: true,
                save: jest.fn().mockResolvedValue({
                    _id: mockUser._id,
                    isActive: false,
                }),
            };

            mockReq.params.id = mockUser._id.toString();

            User.findById = jest.fn().mockResolvedValue(mockUser);

            await toggleActiveStatus(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockUser._id);
            expect(mockUser.isActive).toBe(false);
            expect(mockUser.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario desactivado correctamente'
            });
        });

        it('should return error if user not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            User.findById = jest.fn().mockResolvedValue(null);

            await toggleActiveStatus(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });
    });

    describe('getAllOrders', () => {
        it('should get all orders', async () => {
            const mockOrders = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    title: 'Test Order',
                    price: 100,
                    user: {
                        _id: new mongoose.Types.ObjectId(),
                        name: 'Test User',
                        email: 'test@example.com',
                    },
                    assignedTo: {
                        _id: new mongoose.Types.ObjectId(),
                        name: 'Test Writer',
                        email: 'writer@example.com',
                    },
                },
            ];

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(mockOrders),
                }),
            };

            Order.find = jest.fn().mockReturnValue(mockQuery);

            await getAllOrders(mockReq, mockRes);
            expect(Order.find).toHaveBeenCalledWith({});
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(mockQuery.populate().populate).toHaveBeenCalledWith('assignedTo', 'name email');
            expect(mockRes.json).toHaveBeenCalledWith(mockOrders);
        });
    });

    describe('assignOrderToWriter', () => {
        it('should assign order to writer', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                status: 'pendiente',
                save: jest.fn().mockResolvedValue({
                    _id: mockOrder._id,
                    status: 'asignado',
                    assignedTo: mockReq.body.writerId,
                }),
            };

            mockReq.params.id = mockOrder._id.toString();
            mockReq.body.writerId = new mongoose.Types.ObjectId().toString();

            Order.findById = jest.fn().mockResolvedValue(mockOrder);

            await assignOrderToWriter(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockOrder.assignedTo).toBe(mockReq.body.writerId);
            expect(mockOrder.status).toBe('asignado');
            expect(mockOrder.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Redactor asignado correctamente',
                order: expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    status: 'asignado',
                    assignedTo: mockReq.body.writerId,
                }),
            });
        });

        it('should return error if order not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body.writerId = new mongoose.Types.ObjectId().toString();

            Order.findById = jest.fn().mockResolvedValue(null);

            await assignOrderToWriter(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });
    });

    describe('getStats', () => {
        it('should get admin stats', async () => {
            const mockStats = {
                totalUsers: 10,
                totalWriters: 5,
                totalOrders: 20,
                totalQuotes: 15,
                totalVisits: 100,
                totalIncome: 5000,
                uniqueVisitors: 50,
            };

            User.countDocuments = jest.fn()
                .mockResolvedValueOnce(10)
                .mockResolvedValueOnce(5);
            Order.countDocuments = jest.fn().mockResolvedValue(20);
            Quote.countDocuments = jest.fn().mockResolvedValue(15);
            Visit.countDocuments = jest.fn().mockResolvedValue(100);
            Order.aggregate = jest.fn().mockResolvedValue([{ total: 5000 }]);
            Visit.distinct = jest.fn().mockResolvedValue(Array(50).fill('cookie'));

            await getStats(mockReq, mockRes);
            expect(User.countDocuments).toHaveBeenCalledTimes(2);
            expect(Order.countDocuments).toHaveBeenCalled();
            expect(Quote.countDocuments).toHaveBeenCalled();
            expect(Visit.countDocuments).toHaveBeenCalled();
            expect(Order.aggregate).toHaveBeenCalledWith([
                { $match: { isPaid: true } },
                { $group: { _id: null, total: { $sum: '$price' } } }
            ]);
            expect(Visit.distinct).toHaveBeenCalledWith('cookieId');
            expect(mockRes.json).toHaveBeenCalledWith(mockStats);
        });
    });

    describe('getAllVisits', () => {
        it('should get all visits', async () => {
            const mockVisits = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    path: '/test',
                    cookieId: 'test-cookie',
                    createdAt: new Date(),
                },
            ];

            const mockQuery = {
                sort: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue(mockVisits),
                }),
            };

            Visit.find = jest.fn().mockReturnValue(mockQuery);

            await getAllVisits(mockReq, mockRes);
            expect(Visit.find).toHaveBeenCalledWith({});
            expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockQuery.sort().limit).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(mockVisits);
        });
    });

    describe('getDashboard', () => {
        it('should get dashboard data', async () => {
            const mockDashboard = {
                stats: {
                    totalUsers: 10,
                    totalOrders: 20,
                    totalQuotes: 15,
                    totalVisits: 100,
                    totalIncome: 5000,
                },
                recentData: {
                    orders: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            title: 'Test Order',
                            user: {
                                _id: new mongoose.Types.ObjectId(),
                                name: 'Test User',
                                email: 'test@example.com',
                            },
                        },
                    ],
                    quotes: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            taskTitle: 'Test Quote',
                            user: {
                                _id: new mongoose.Types.ObjectId(),
                                name: 'Test User',
                                email: 'test@example.com',
                            },
                        },
                    ],
                    users: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            name: 'Test User',
                            email: 'test@example.com',
                        },
                    ],
                    visits: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            path: '/test',
                            cookieId: 'test-cookie',
                        },
                    ],
                },
            };

            User.countDocuments = jest.fn().mockResolvedValue(10);
            Order.countDocuments = jest.fn().mockResolvedValue(20);
            Quote.countDocuments = jest.fn().mockResolvedValue(15);
            Visit.countDocuments = jest.fn().mockResolvedValue(100);
            Order.aggregate = jest.fn().mockResolvedValue([{ total: 5000 }]);

            const mockOrderQuery = {
                populate: jest.fn().mockReturnValue({
                    sort: jest.fn().mockReturnValue({
                        limit: jest.fn().mockResolvedValue(mockDashboard.recentData.orders),
                    }),
                }),
            };

            const mockQuoteQuery = {
                populate: jest.fn().mockReturnValue({
                    sort: jest.fn().mockReturnValue({
                        limit: jest.fn().mockResolvedValue(mockDashboard.recentData.quotes),
                    }),
                }),
            };

            const mockUserQuery = {
                select: jest.fn().mockReturnValue({
                    sort: jest.fn().mockReturnValue({
                        limit: jest.fn().mockResolvedValue(mockDashboard.recentData.users),
                    }),
                }),
            };

            const mockVisitQuery = {
                sort: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue(mockDashboard.recentData.visits),
                }),
            };

            Order.find = jest.fn().mockReturnValue(mockOrderQuery);
            Quote.find = jest.fn().mockReturnValue(mockQuoteQuery);
            User.find = jest.fn().mockReturnValue(mockUserQuery);
            Visit.find = jest.fn().mockReturnValue(mockVisitQuery);

            await getDashboard(mockReq, mockRes);
            expect(User.countDocuments).toHaveBeenCalled();
            expect(Order.countDocuments).toHaveBeenCalled();
            expect(Quote.countDocuments).toHaveBeenCalled();
            expect(Visit.countDocuments).toHaveBeenCalled();
            expect(Order.aggregate).toHaveBeenCalled();
            expect(Order.find).toHaveBeenCalled();
            expect(Quote.find).toHaveBeenCalled();
            expect(User.find).toHaveBeenCalled();
            expect(Visit.find).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(mockDashboard);
        });
    });

    describe('searchAdmin', () => {
        it('should search users', async () => {
            const mockUsers = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test User',
                    email: 'test@example.com',
                },
            ];

            mockReq.query.query = 'test';
            mockReq.query.type = 'users';

            const mockQuery = {
                select: jest.fn().mockResolvedValue(mockUsers),
            };

            User.find = jest.fn().mockReturnValue(mockQuery);

            await searchAdmin(mockReq, mockRes);
            expect(User.find).toHaveBeenCalledWith({
                $or: [
                    { name: { $regex: 'test', $options: 'i' } },
                    { email: { $regex: 'test', $options: 'i' } },
                ]
            });
            expect(mockQuery.select).toHaveBeenCalledWith('-password');
            expect(mockRes.json).toHaveBeenCalledWith(mockUsers);
        });

        it('should search orders', async () => {
            const mockOrders = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    title: 'Test Order',
                    user: {
                        _id: new mongoose.Types.ObjectId(),
                        name: 'Test User',
                        email: 'test@example.com',
                    },
                },
            ];

            mockReq.query.query = 'test';
            mockReq.query.type = 'orders';

            const mockQuery = {
                populate: jest.fn().mockResolvedValue(mockOrders),
            };

            Order.find = jest.fn().mockReturnValue(mockQuery);

            await searchAdmin(mockReq, mockRes);
            expect(Order.find).toHaveBeenCalledWith({
                $or: [
                    { title: { $regex: 'test', $options: 'i' } },
                    { status: { $regex: 'test', $options: 'i' } },
                ]
            });
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(mockRes.json).toHaveBeenCalledWith(mockOrders);
        });

        it('should search quotes', async () => {
            const mockQuotes = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    taskTitle: 'Test Quote',
                    user: {
                        _id: new mongoose.Types.ObjectId(),
                        name: 'Test User',
                        email: 'test@example.com',
                    },
                },
            ];

            mockReq.query.query = 'test';
            mockReq.query.type = 'quotes';

            const mockQuery = {
                populate: jest.fn().mockResolvedValue(mockQuotes),
            };

            Quote.find = jest.fn().mockReturnValue(mockQuery);

            await searchAdmin(mockReq, mockRes);
            expect(Quote.find).toHaveBeenCalledWith({
                $or: [
                    { taskTitle: { $regex: 'test', $options: 'i' } },
                    { studyArea: { $regex: 'test', $options: 'i' } },
                ]
            });
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(mockRes.json).toHaveBeenCalledWith(mockQuotes);
        });

        it('should return error if query or type is missing', async () => {
            mockReq.query.query = '';
            mockReq.query.type = '';

            await searchAdmin(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Se requiere un término de búsqueda y un tipo'
            });
        });

        it('should return error if type is invalid', async () => {
            mockReq.query.query = 'test';
            mockReq.query.type = 'invalid';

            await searchAdmin(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Tipo de búsqueda no válido'
            });
        });
    });

    describe('getOrderById', () => {
        it('should get order by id', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                user: {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test User',
                    email: 'test@example.com',
                },
                assignedTo: {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test Writer',
                    email: 'writer@example.com',
                },
            };

            mockReq.params.id = mockOrder._id.toString();

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(mockOrder),
                }),
            };

            Order.findById = jest.fn().mockReturnValue(mockQuery);

            await getOrderById(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(mockQuery.populate().populate).toHaveBeenCalledWith('assignedTo', 'name email');
            expect(mockRes.json).toHaveBeenCalledWith(mockOrder);
        });

        it('should return error if order not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(null),
                }),
            };

            Order.findById = jest.fn().mockReturnValue(mockQuery);

            await getOrderById(mockReq, mockRes);
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
                status: 'pendiente',
                price: 100,
                dueDate: new Date(),
                requirements: {
                    text: 'Test requirements',
                    file: null,
                },
                save: jest.fn().mockResolvedValue({
                    _id: mockOrder._id,
                    title: 'Updated Order',
                    status: 'asignado',
                    price: 150,
                    dueDate: new Date(),
                    requirements: {
                        text: 'Updated requirements',
                        file: 'test.pdf',
                    },
                }),
            };

            mockReq.params.id = mockOrder._id.toString();
            mockReq.body = {
                title: 'Updated Order',
                status: 'asignado',
                price: 150,
                dueDate: new Date(),
                requirements: {
                    text: 'Updated requirements',
                    file: 'test.pdf',
                },
            };

            Order.findById = jest.fn().mockResolvedValue(mockOrder);

            await updateOrder(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockOrder.title).toBe('Updated Order');
            expect(mockOrder.status).toBe('asignado');
            expect(mockOrder.price).toBe(150);
            expect(mockOrder.dueDate).toEqual(mockReq.body.dueDate);
            expect(mockOrder.requirements).toEqual(mockReq.body.requirements);
            expect(mockOrder.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    title: 'Updated Order',
                    status: 'asignado',
                    price: 150,
                    requirements: {
                        text: 'Updated requirements',
                        file: 'test.pdf',
                    },
                })
            );
        });

        it('should return error if order not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body = {
                title: 'Updated Order',
                status: 'asignado',
            };

            Order.findById = jest.fn().mockResolvedValue(null);

            await updateOrder(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });

        it('should return error if status is invalid', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                status: 'pendiente',
            };

            mockReq.params.id = mockOrder._id.toString();
            mockReq.body = {
                status: 'invalid',
            };

            Order.findById = jest.fn().mockResolvedValue(mockOrder);

            await updateOrder(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Estado no válido. Valores permitidos: pendiente, asignado, en progreso, entregado, cancelado'
            });
        });

        it('should return error if requirements is invalid', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                requirements: {
                    text: 'Test requirements',
                    file: null,
                },
            };

            mockReq.params.id = mockOrder._id.toString();
            mockReq.body = {
                requirements: 'invalid',
            };

            Order.findById = jest.fn().mockResolvedValue(mockOrder);

            await updateOrder(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'El campo requirements debe ser un objeto con la estructura { text: string, file: string }'
            });
        });
    });
}); 