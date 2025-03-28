import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    getAdminNotifications,
    getMyNotifications,
    markNotificationAsRead,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    getNotificationStats,
} from '../controllers/notificationController.js';
import Notification from '../models/Notification.js';

// Mock de los modelos
jest.mock('../models/Notification.js');

describe('Notification Controller', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            query: {},
            params: {},
            user: {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                role: 'user',
            },
            app: {
                get: jest.fn().mockReturnValue({
                    to: jest.fn().mockReturnValue({
                        emit: jest.fn(),
                    }),
                }),
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

    describe('getAdminNotifications', () => {
        it('should get admin notifications with pagination', async () => {
            const mockNotifications = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    user: process.env.SUPER_ADMIN_ID,
                    type: 'test',
                    message: 'Test notification',
                    isRead: false,
                    createdAt: new Date(),
                },
            ];

            mockReq.user._id = process.env.SUPER_ADMIN_ID;
            mockReq.query.page = '1';
            mockReq.query.limit = '20';

            const mockQuery = {
                sort: jest.fn().mockReturnValue({
                    skip: jest.fn().mockReturnValue({
                        limit: jest.fn().mockReturnValue({
                            populate: jest.fn().mockResolvedValue(mockNotifications),
                        }),
                    }),
                }),
            };

            Notification.find = jest.fn().mockReturnValue(mockQuery);
            Notification.countDocuments = jest.fn().mockResolvedValue(1);

            await getAdminNotifications(mockReq, mockRes);
            expect(Notification.find).toHaveBeenCalledWith({ user: process.env.SUPER_ADMIN_ID });
            expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockQuery.skip).toHaveBeenCalledWith(0);
            expect(mockQuery.limit).toHaveBeenCalledWith(20);
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(Notification.countDocuments).toHaveBeenCalledWith({ user: process.env.SUPER_ADMIN_ID });
            expect(mockRes.json).toHaveBeenCalledWith({
                notifications: mockNotifications,
                pagination: {
                    page: 1,
                    limit: 20,
                    total: 1,
                    pages: 1,
                },
            });
        });

        it('should return error if user is not admin', async () => {
            mockReq.user._id = new mongoose.Types.ObjectId();

            await getAdminNotifications(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Acceso denegado'
            });
        });
    });

    describe('getMyNotifications', () => {
        it('should get user notifications with pagination and filters', async () => {
            const mockNotifications = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    user: mockReq.user._id,
                    type: 'test',
                    message: 'Test notification',
                    isRead: false,
                    createdAt: new Date(),
                },
            ];

            mockReq.query.page = '1';
            mockReq.query.limit = '20';
            mockReq.query.isRead = 'false';

            const mockQuery = {
                sort: jest.fn().mockReturnValue({
                    skip: jest.fn().mockReturnValue({
                        limit: jest.fn().mockReturnValue({
                            populate: jest.fn().mockResolvedValue(mockNotifications),
                        }),
                    }),
                }),
            };

            Notification.find = jest.fn().mockReturnValue(mockQuery);
            Notification.countDocuments = jest.fn().mockResolvedValue(1);

            await getMyNotifications(mockReq, mockRes);
            expect(Notification.find).toHaveBeenCalledWith({
                user: mockReq.user._id,
                isRead: false,
            });
            expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockQuery.skip).toHaveBeenCalledWith(0);
            expect(mockQuery.limit).toHaveBeenCalledWith(20);
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(Notification.countDocuments).toHaveBeenCalledWith({
                user: mockReq.user._id,
                isRead: false,
            });
            expect(mockRes.json).toHaveBeenCalledWith({
                notifications: mockNotifications,
                pagination: {
                    page: 1,
                    limit: 20,
                    total: 1,
                    pages: 1,
                },
            });
        });
    });

    describe('markNotificationAsRead', () => {
        it('should mark admin notification as read', async () => {
            const mockNotification = {
                _id: new mongoose.Types.ObjectId(),
                user: process.env.SUPER_ADMIN_ID,
                type: 'test',
                message: 'Test notification',
                isRead: false,
                save: jest.fn().mockResolvedValue({
                    _id: mockNotification._id,
                    isRead: true,
                }),
            };

            mockReq.user._id = process.env.SUPER_ADMIN_ID;
            mockReq.params.id = mockNotification._id.toString();

            Notification.findById = jest.fn().mockResolvedValue(mockNotification);

            await markNotificationAsRead(mockReq, mockRes);
            expect(Notification.findById).toHaveBeenCalledWith(mockNotification._id);
            expect(mockNotification.save).toHaveBeenCalled();
            expect(mockReq.app.get('io').to).toHaveBeenCalledWith(`notifications:${process.env.SUPER_ADMIN_ID}`);
            expect(mockReq.app.get('io').to().emit).toHaveBeenCalledWith('notificationRead', {
                notificationId: mockNotification._id,
                isRead: true,
            });
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Notificación marcada como leída'
            });
        });

        it('should return error if notification not found', async () => {
            mockReq.user._id = process.env.SUPER_ADMIN_ID;
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            Notification.findById = jest.fn().mockResolvedValue(null);

            await markNotificationAsRead(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Notificación no encontrada'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockNotification = {
                _id: new mongoose.Types.ObjectId(),
                user: new mongoose.Types.ObjectId(), // Different user
            };

            mockReq.user._id = process.env.SUPER_ADMIN_ID;
            mockReq.params.id = mockNotification._id.toString();

            Notification.findById = jest.fn().mockResolvedValue(mockNotification);

            await markNotificationAsRead(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado'
            });
        });
    });

    describe('markAsRead', () => {
        it('should mark user notification as read', async () => {
            const mockNotification = {
                _id: new mongoose.Types.ObjectId(),
                user: mockReq.user._id,
                type: 'test',
                message: 'Test notification',
                isRead: false,
                save: jest.fn().mockResolvedValue({
                    _id: mockNotification._id,
                    isRead: true,
                }),
            };

            mockReq.params.id = mockNotification._id.toString();

            Notification.findById = jest.fn().mockResolvedValue(mockNotification);

            await markAsRead(mockReq, mockRes);
            expect(Notification.findById).toHaveBeenCalledWith(mockNotification._id);
            expect(mockNotification.save).toHaveBeenCalled();
            expect(mockReq.app.get('io').to).toHaveBeenCalledWith(`notifications:${mockReq.user._id}`);
            expect(mockReq.app.get('io').to().emit).toHaveBeenCalledWith('notificationRead', {
                notificationId: mockNotification._id,
                isRead: true,
            });
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Notificación marcada como leída'
            });
        });

        it('should return error if notification not found or unauthorized', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            Notification.findById = jest.fn().mockResolvedValue(null);

            await markAsRead(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Notificación no encontrada o acceso no autorizado'
            });
        });
    });

    describe('markAllAsRead', () => {
        it('should mark all user notifications as read', async () => {
            const mockResult = {
                modifiedCount: 5,
            };

            Notification.updateMany = jest.fn().mockResolvedValue(mockResult);

            await markAllAsRead(mockReq, mockRes);
            expect(Notification.updateMany).toHaveBeenCalledWith(
                { user: mockReq.user._id, isRead: false },
                { $set: { isRead: true } }
            );
            expect(mockReq.app.get('io').to).toHaveBeenCalledWith(`notifications:${mockReq.user._id}`);
            expect(mockReq.app.get('io').to().emit).toHaveBeenCalledWith('allNotificationsRead');
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Todas las notificaciones marcadas como leídas',
                modifiedCount: 5,
            });
        });
    });

    describe('deleteNotification', () => {
        it('should delete user notification', async () => {
            const mockNotification = {
                _id: new mongoose.Types.ObjectId(),
                user: mockReq.user._id,
                type: 'test',
                message: 'Test notification',
                deleteOne: jest.fn().mockResolvedValue({}),
            };

            mockReq.params.id = mockNotification._id.toString();

            Notification.findById = jest.fn().mockResolvedValue(mockNotification);

            await deleteNotification(mockReq, mockRes);
            expect(Notification.findById).toHaveBeenCalledWith(mockNotification._id);
            expect(mockNotification.deleteOne).toHaveBeenCalled();
            expect(mockReq.app.get('io').to).toHaveBeenCalledWith(`notifications:${mockReq.user._id}`);
            expect(mockReq.app.get('io').to().emit).toHaveBeenCalledWith('notificationDeleted', {
                notificationId: mockNotification._id,
            });
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Notificación eliminada'
            });
        });

        it('should return error if notification not found or unauthorized', async () => {
            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            Notification.findById = jest.fn().mockResolvedValue(null);

            await deleteNotification(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Notificación no encontrada o acceso no autorizado'
            });
        });
    });

    describe('getNotificationStats', () => {
        it('should get notification statistics', async () => {
            const mockStats = [
                { _id: true, count: 5 }, // Read notifications
                { _id: false, count: 3 }, // Unread notifications
            ];

            Notification.aggregate = jest.fn().mockResolvedValue(mockStats);

            await getNotificationStats(mockReq, mockRes);
            expect(Notification.aggregate).toHaveBeenCalledWith([
                { $match: { user: mockReq.user._id } },
                {
                    $group: {
                        _id: '$isRead',
                        count: { $sum: 1 },
                    },
                },
            ]);
            expect(mockRes.json).toHaveBeenCalledWith({
                total: 8,
                unread: 3,
                read: 5,
            });
        });
    });
}); 