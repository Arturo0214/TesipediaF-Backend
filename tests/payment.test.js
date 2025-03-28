import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    createStripeSession,
    stripeWebhook,
    getPayments,
    getPaymentById,
    updatePayment,
    deletePayment,
    getMyPayments,
} from '../controllers/paymentController.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Notification from '../models/Notification.js';
import stripe from '../config/stripe.js';
import emailSender from '../utils/emailSender.js';

// Mock de los modelos y utilidades
jest.mock('../models/Order.js');
jest.mock('../models/Payment.js');
jest.mock('../models/Notification.js');
jest.mock('../config/stripe.js');
jest.mock('../utils/emailSender.js');

describe('Payment Controller', () => {
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
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createStripeSession', () => {
        it('should create stripe session', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                price: 100,
            };

            const mockSession = {
                id: 'test-session-id',
                url: 'https://test.stripe.com/checkout',
            };

            mockReq.body.orderId = mockOrder._id.toString();

            Order.findById = jest.fn().mockResolvedValue(mockOrder);
            stripe.checkout.sessions.create = jest.fn().mockResolvedValue(mockSession);
            Payment.create = jest.fn().mockResolvedValue({});

            await createStripeSession(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(stripe.checkout.sessions.create).toHaveBeenCalledWith({
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'mxn',
                        product_data: {
                            name: 'Test Order',
                        },
                        unit_amount: 10000, // 100 * 100 (centavos)
                    },
                    quantity: 1,
                }],
                mode: 'payment',
                success_url: expect.stringContaining('/pago-exitoso'),
                cancel_url: expect.stringContaining('/pago-cancelado'),
                metadata: {
                    orderId: mockOrder._id.toString(),
                },
            });
            expect(Payment.create).toHaveBeenCalledWith({
                order: mockOrder._id,
                method: 'stripe',
                amount: 100,
                transactionId: 'test-session-id',
                status: 'pendiente',
            });
            expect(mockRes.status(200).json).toHaveBeenCalledWith({
                url: 'https://test.stripe.com/checkout',
            });
        });

        it('should return error if order not found', async () => {
            mockReq.body.orderId = new mongoose.Types.ObjectId().toString();

            Order.findById = jest.fn().mockResolvedValue(null);

            await createStripeSession(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });
    });

    describe('stripeWebhook', () => {
        it('should handle successful payment', async () => {
            const mockOrder = {
                _id: new mongoose.Types.ObjectId(),
                title: 'Test Order',
                price: 100,
                user: {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test User',
                    email: 'test@example.com',
                },
                save: jest.fn().mockResolvedValue({
                    _id: mockOrder._id,
                    isPaid: true,
                    paymentDate: expect.any(Date),
                    status: 'paid',
                }),
            };

            const mockPayment = {
                _id: new mongoose.Types.ObjectId(),
                order: mockOrder._id,
                status: 'pendiente',
                save: jest.fn().mockResolvedValue({
                    _id: mockPayment._id,
                    status: 'completed',
                }),
            };

            mockReq.body = {
                type: 'checkout.session.completed',
                data: {
                    object: {
                        metadata: {
                            orderId: mockOrder._id.toString(),
                        },
                    },
                },
            };

            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockOrder),
            });
            Payment.findOne = jest.fn().mockResolvedValue(mockPayment);
            Notification.create = jest.fn().mockResolvedValue({});
            emailSender = jest.fn().mockResolvedValue({});

            await stripeWebhook(mockReq, mockRes);
            expect(Order.findById).toHaveBeenCalledWith(mockOrder._id);
            expect(mockOrder.save).toHaveBeenCalled();
            expect(Payment.findOne).toHaveBeenCalledWith({ order: mockOrder._id });
            expect(mockPayment.save).toHaveBeenCalled();
            expect(Notification.create).toHaveBeenCalledWith({
                user: mockOrder.user._id,
                type: 'pago',
                message: expect.stringContaining('Pago confirmado'),
                data: {
                    orderId: mockOrder._id,
                    amount: 100,
                },
            });
            expect(emailSender).toHaveBeenCalledWith(
                'test@example.com',
                '✅ Pago Confirmado - Tesipedia',
                expect.any(String)
            );
            expect(Notification.create).toHaveBeenCalledWith({
                user: process.env.SUPER_ADMIN_ID,
                type: 'pago',
                message: expect.stringContaining('Nuevo pago confirmado'),
                data: {
                    orderId: mockOrder._id,
                    userId: mockOrder.user._id,
                    amount: 100,
                },
            });
            expect(mockRes.status(200).json).toHaveBeenCalledWith({
                message: '✅ Pedido marcado como pagado'
            });
        });

        it('should return error if orderId is missing', async () => {
            mockReq.body = {
                type: 'checkout.session.completed',
                data: {
                    object: {
                        metadata: {},
                    },
                },
            };

            await stripeWebhook(mockReq, mockRes);
            expect(mockRes.status(400).json).toHaveBeenCalledWith({
                message: 'Falta el orderId en metadata'
            });
        });

        it('should return error if order not found', async () => {
            mockReq.body = {
                type: 'checkout.session.completed',
                data: {
                    object: {
                        metadata: {
                            orderId: new mongoose.Types.ObjectId().toString(),
                        },
                    },
                },
            };

            Order.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(null),
            });

            await stripeWebhook(mockReq, mockRes);
            expect(mockRes.status(404).json).toHaveBeenCalledWith({
                message: 'Pedido no encontrado'
            });
        });

        it('should handle other webhook events', async () => {
            mockReq.body = {
                type: 'other.event',
            };

            await stripeWebhook(mockReq, mockRes);
            expect(mockRes.status(200).json).toHaveBeenCalledWith({
                received: true
            });
        });
    });

    describe('getPayments', () => {
        it('should get all payments', async () => {
            const mockPayments = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    order: {
                        _id: new mongoose.Types.ObjectId(),
                        title: 'Test Order',
                        price: 100,
                    },
                    method: 'stripe',
                    amount: 100,
                    status: 'completed',
                    createdAt: new Date(),
                },
            ];

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    sort: jest.fn().mockResolvedValue(mockPayments),
                }),
            };

            Payment.find = jest.fn().mockReturnValue(mockQuery);

            await getPayments(mockReq, mockRes);
            expect(Payment.find).toHaveBeenCalledWith({});
            expect(mockQuery.populate).toHaveBeenCalledWith('order', 'title price');
            expect(mockQuery.populate().sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockRes.json).toHaveBeenCalledWith(mockPayments);
        });
    });

    describe('getPaymentById', () => {
        it('should get payment by id', async () => {
            const mockPayment = {
                _id: new mongoose.Types.ObjectId(),
                order: {
                    _id: new mongoose.Types.ObjectId(),
                    title: 'Test Order',
                    price: 100,
                },
                method: 'stripe',
                amount: 100,
                status: 'completed',
            };

            mockReq.params.id = mockPayment._id.toString();

            const mockQuery = {
                populate: jest.fn().mockResolvedValue(mockPayment),
            };

            Payment.findById = jest.fn().mockReturnValue(mockQuery);

            await getPaymentById(mockReq, mockRes);
            expect(Payment.findById).toHaveBeenCalledWith(mockPayment._id);
            expect(mockQuery.populate).toHaveBeenCalledWith('order', 'title price');
            expect(mockRes.json).toHaveBeenCalledWith(mockPayment);
        });

        it('should return error if payment not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            const mockQuery = {
                populate: jest.fn().mockResolvedValue(null),
            };

            Payment.findById = jest.fn().mockReturnValue(mockQuery);

            await getPaymentById(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pago no encontrado'
            });
        });
    });

    describe('updatePayment', () => {
        it('should update payment', async () => {
            const mockPayment = {
                _id: new mongoose.Types.ObjectId(),
                method: 'stripe',
                amount: 100,
                transactionId: 'test-transaction',
                status: 'pendiente',
                save: jest.fn().mockResolvedValue({
                    _id: mockPayment._id,
                    method: 'paypal',
                    amount: 150,
                    transactionId: 'new-transaction',
                    status: 'completed',
                }),
            };

            mockReq.params.id = mockPayment._id.toString();
            mockReq.body = {
                method: 'paypal',
                amount: 150,
                transactionId: 'new-transaction',
                status: 'completed',
            };

            Payment.findById = jest.fn().mockResolvedValue(mockPayment);

            await updatePayment(mockReq, mockRes);
            expect(Payment.findById).toHaveBeenCalledWith(mockPayment._id);
            expect(mockPayment.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    method: 'paypal',
                    amount: 150,
                    transactionId: 'new-transaction',
                    status: 'completed',
                })
            );
        });

        it('should return error if payment not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body = {
                method: 'paypal',
                amount: 150,
                transactionId: 'new-transaction',
                status: 'completed',
            };

            Payment.findById = jest.fn().mockResolvedValue(null);

            await updatePayment(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pago no encontrado'
            });
        });
    });

    describe('deletePayment', () => {
        it('should delete payment', async () => {
            const mockPayment = {
                _id: new mongoose.Types.ObjectId(),
                deleteOne: jest.fn().mockResolvedValue({}),
            };

            mockReq.params.id = mockPayment._id.toString();

            Payment.findById = jest.fn().mockResolvedValue(mockPayment);

            await deletePayment(mockReq, mockRes);
            expect(Payment.findById).toHaveBeenCalledWith(mockPayment._id);
            expect(mockPayment.deleteOne).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pago eliminado correctamente'
            });
        });

        it('should return error if payment not found', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            Payment.findById = jest.fn().mockResolvedValue(null);

            await deletePayment(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Pago no encontrado'
            });
        });
    });

    describe('getMyPayments', () => {
        it('should get user payments', async () => {
            const mockPayments = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    order: {
                        _id: new mongoose.Types.ObjectId(),
                        title: 'Test Order',
                        price: 100,
                        user: mockReq.user._id,
                    },
                    method: 'stripe',
                    amount: 100,
                    status: 'completed',
                    createdAt: new Date(),
                },
            ];

            const mockQuery = {
                populate: jest.fn().mockReturnValue({
                    sort: jest.fn().mockResolvedValue(mockPayments),
                }),
            };

            Payment.find = jest.fn().mockReturnValue(mockQuery);

            await getMyPayments(mockReq, mockRes);
            expect(Payment.find).toHaveBeenCalledWith({ 'order.user': mockReq.user._id });
            expect(mockQuery.populate).toHaveBeenCalledWith('order', 'title price');
            expect(mockQuery.populate().sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockRes.json).toHaveBeenCalledWith(mockPayments);
        });
    });
}); 