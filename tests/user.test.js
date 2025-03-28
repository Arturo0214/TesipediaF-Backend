import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    getUsers,
    getUserById,
    updateUser,
    deleteUser,
    getUserProfile,
    updateUserProfile,
    searchUsers,
} from '../controllers/userController.js';
import User from '../models/User.js';

// Mock del modelo
jest.mock('../models/User.js');

describe('User Controller', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            params: {},
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

    describe('getUserProfile', () => {
        it('should get user profile', async () => {
            const mockUser = {
                _id: mockReq.user._id,
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
            };

            await getUserProfile(mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({
                _id: mockReq.user._id,
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
            });
        });

        it('should return error if user not found', async () => {
            mockReq.user = null;

            await getUserProfile(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });
    });

    describe('updateUserProfile', () => {
        it('should update user profile', async () => {
            const mockUser = {
                _id: mockReq.user._id,
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
                save: jest.fn().mockResolvedValue({
                    _id: mockUser._id,
                    name: 'Updated Name',
                    email: 'test@example.com',
                    role: 'user',
                }),
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);

            mockReq.body = {
                name: 'Updated Name',
                password: 'newpassword123',
            };

            await updateUserProfile(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockReq.user._id);
            expect(mockUser.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    name: 'Updated Name',
                    email: 'test@example.com',
                    role: 'user',
                    token: null,
                })
            );
        });

        it('should return error if user not found', async () => {
            User.findById = jest.fn().mockResolvedValue(null);

            mockReq.body = {
                name: 'Updated Name',
            };

            await updateUserProfile(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });
    });

    describe('getUsers', () => {
        it('should get all users for admin', async () => {
            const mockUsers = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test User 1',
                    email: 'test1@example.com',
                    role: 'user',
                },
                {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test User 2',
                    email: 'test2@example.com',
                    role: 'user',
                },
            ];

            User.find = jest.fn().mockResolvedValue(mockUsers);

            await getUsers(mockReq, mockRes);
            expect(User.find).toHaveBeenCalledWith({});
            expect(mockRes.json).toHaveBeenCalledWith(mockUsers);
        });

        it('should return error if user is not admin', async () => {
            mockReq.user.role = 'user';

            await getUsers(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado para ver todos los usuarios'
            });
        });

        it('should return empty array if no users', async () => {
            User.find = jest.fn().mockResolvedValue([]);

            await getUsers(mockReq, mockRes);
            expect(User.find).toHaveBeenCalledWith({});
            expect(mockRes.json).toHaveBeenCalledWith([]);
        });
    });

    describe('getUserById', () => {
        it('should get user by id', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);

            mockReq.params.id = mockUser._id.toString();

            await getUserById(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockUser._id);
            expect(mockRes.json).toHaveBeenCalledWith(mockUser);
        });

        it('should return error if user not found', async () => {
            User.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await getUserById(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);
            mockReq.user.role = 'user';
            mockReq.user._id = new mongoose.Types.ObjectId(); // Different user

            mockReq.params.id = mockUser._id.toString();

            await getUserById(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado para ver este usuario'
            });
        });
    });

    describe('updateUser', () => {
        it('should update user', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
                save: jest.fn().mockResolvedValue({
                    _id: mockUser._id,
                    name: 'Updated User',
                    email: 'test@example.com',
                    role: 'user',
                }),
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);

            mockReq.params.id = mockUser._id.toString();
            mockReq.body = {
                name: 'Updated User',
            };

            await updateUser(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockUser._id);
            expect(mockUser.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    name: 'Updated User',
                    email: 'test@example.com',
                    role: 'user',
                })
            );
        });

        it('should return error if user not found', async () => {
            User.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body = {
                name: 'Updated User',
            };

            await updateUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);
            mockReq.user.role = 'user';
            mockReq.user._id = new mongoose.Types.ObjectId(); // Different user

            mockReq.params.id = mockUser._id.toString();
            mockReq.body = {
                name: 'Updated User',
            };

            await updateUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado para actualizar este usuario'
            });
        });
    });

    describe('deleteUser', () => {
        it('should delete user', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);
            User.prototype.deleteOne = jest.fn().mockResolvedValue({});

            mockReq.params.id = mockUser._id.toString();

            await deleteUser(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockUser._id);
            expect(mockUser.deleteOne).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario eliminado correctamente'
            });
        });

        it('should return error if user not found', async () => {
            User.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await deleteUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });

        it('should return error if user is not authorized', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                role: 'user',
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);
            mockReq.user.role = 'user';
            mockReq.user._id = new mongoose.Types.ObjectId(); // Different user

            mockReq.params.id = mockUser._id.toString();

            await deleteUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No autorizado para eliminar este usuario'
            });
        });
    });

    describe('searchUsers', () => {
        it('should search users by name or email', async () => {
            const mockUsers = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    name: 'Test User',
                    email: 'test@example.com',
                    role: 'user',
                },
            ];

            const mockQuery = {
                select: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(mockUsers),
            };

            User.find = jest.fn().mockReturnValue(mockQuery);

            mockReq.query.query = 'test';

            await searchUsers(mockReq, mockRes);
            expect(User.find).toHaveBeenCalledWith({
                $or: [
                    { name: { $regex: 'test', $options: 'i' } },
                    { email: { $regex: 'test', $options: 'i' } },
                ],
            });
            expect(mockQuery.select).toHaveBeenCalledWith('-password');
            expect(mockQuery.exec).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(mockUsers);
        });
    });
}); 