import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    registerUser,
    loginUser,
    requestPasswordReset,
    resetPassword,
    updateProfile,
    changePassword,
} from '../controllers/authController.js';
import User from '../models/User.js';
import crypto from 'crypto';

// Mock de los modelos
jest.mock('../models/User.js');

describe('Auth Controller', () => {
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
                email: 'test@example.com',
                password: 'hashedPassword123',
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

    describe('registerUser', () => {
        it('should register a new user', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'New User',
                email: 'new@example.com',
                role: 'user',
            };

            User.findOne = jest.fn().mockResolvedValue(null);
            User.create = jest.fn().mockResolvedValue(mockUser);

            mockReq.body = {
                name: 'New User',
                email: 'new@example.com',
                password: 'password123',
            };

            await registerUser(mockReq, mockRes);
            expect(User.findOne).toHaveBeenCalledWith({ email: 'new@example.com' });
            expect(User.create).toHaveBeenCalled();
            expect(mockRes.status(201).json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    name: 'New User',
                    email: 'new@example.com',
                    role: 'user',
                })
            );
        });

        it('should return error if user already exists', async () => {
            User.findOne = jest.fn().mockResolvedValue({
                _id: new mongoose.Types.ObjectId(),
                email: 'existing@example.com',
            });

            mockReq.body = {
                name: 'New User',
                email: 'existing@example.com',
                password: 'password123',
            };

            await registerUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Este correo ya está registrado'
            });
        });
    });

    describe('loginUser', () => {
        it('should login user with valid credentials', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                password: 'hashedPassword123',
                role: 'user',
            };

            User.findOne = jest.fn().mockResolvedValue(mockUser);
            User.prototype.matchPassword = jest.fn().mockResolvedValue(true);

            mockReq.body = {
                email: 'test@example.com',
                password: 'password123',
            };

            await loginUser(mockReq, mockRes);
            expect(User.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
            expect(mockUser.matchPassword).toHaveBeenCalledWith('password123');
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    name: 'Test User',
                    email: 'test@example.com',
                    role: 'user',
                    token: expect.any(String),
                })
            );
        });

        it('should return error for invalid credentials', async () => {
            User.findOne = jest.fn().mockResolvedValue(null);

            mockReq.body = {
                email: 'invalid@example.com',
                password: 'wrongpassword',
            };

            await loginUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Correo o contraseña inválidos'
            });
        });
    });

    describe('requestPasswordReset', () => {
        it('should send reset password email', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                email: 'test@example.com',
                save: jest.fn().mockResolvedValue({}),
            };

            User.findOne = jest.fn().mockResolvedValue(mockUser);

            mockReq.body = {
                email: 'test@example.com',
            };

            await requestPasswordReset(mockReq, mockRes);
            expect(User.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
            expect(mockUser.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Se ha enviado un enlace de restablecimiento a tu correo.'
            });
        });

        it('should return error if user not found', async () => {
            User.findOne = jest.fn().mockResolvedValue(null);

            mockReq.body = {
                email: 'nonexistent@example.com',
            };

            await requestPasswordReset(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'No se encontró una cuenta con este correo.'
            });
        });
    });

    describe('resetPassword', () => {
        it('should reset password with valid token', async () => {
            const resetToken = crypto.randomBytes(32).toString('hex');
            const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                resetPasswordToken: hashedToken,
                resetPasswordExpires: Date.now() + 3600000, // 1 hour from now
                save: jest.fn().mockResolvedValue({}),
            };

            User.findOne = jest.fn().mockResolvedValue(mockUser);

            mockReq.params.token = resetToken;
            mockReq.body = {
                password: 'newpassword123',
            };

            await resetPassword(mockReq, mockRes);
            expect(User.findOne).toHaveBeenCalledWith({
                resetPasswordToken: hashedToken,
                resetPasswordExpires: expect.any(Number),
            });
            expect(mockUser.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Contraseña actualizada correctamente.'
            });
        });

        it('should return error for invalid token', async () => {
            User.findOne = jest.fn().mockResolvedValue(null);

            mockReq.params.token = 'invalid-token';
            mockReq.body = {
                password: 'newpassword123',
            };

            await resetPassword(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'El token no es válido o ha expirado.'
            });
        });
    });

    describe('updateProfile', () => {
        it('should update user profile', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test User',
                email: 'test@example.com',
                save: jest.fn().mockResolvedValue({
                    _id: mockUser._id,
                    name: 'Updated Name',
                    email: 'test@example.com',
                }),
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);

            mockReq.body = {
                name: 'Updated Name',
            };

            await updateProfile(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockReq.user._id);
            expect(mockUser.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    name: 'Updated Name',
                    email: 'test@example.com',
                })
            );
        });

        it('should return error if user not found', async () => {
            User.findById = jest.fn().mockResolvedValue(null);

            mockReq.body = {
                name: 'Updated Name',
            };

            await updateProfile(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Usuario no encontrado'
            });
        });
    });

    describe('changePassword', () => {
        it('should change password with valid current password', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                password: 'hashedPassword123',
                matchPassword: jest.fn().mockResolvedValue(true),
                save: jest.fn().mockResolvedValue({}),
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);

            mockReq.body = {
                currentPassword: 'currentPassword123',
                newPassword: 'newPassword123',
            };

            await changePassword(mockReq, mockRes);
            expect(User.findById).toHaveBeenCalledWith(mockReq.user._id);
            expect(mockUser.matchPassword).toHaveBeenCalledWith('currentPassword123');
            expect(mockUser.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Contraseña actualizada correctamente'
            });
        });

        it('should return error for invalid current password', async () => {
            const mockUser = {
                _id: new mongoose.Types.ObjectId(),
                password: 'hashedPassword123',
                matchPassword: jest.fn().mockResolvedValue(false),
            };

            User.findById = jest.fn().mockResolvedValue(mockUser);

            mockReq.body = {
                currentPassword: 'wrongPassword',
                newPassword: 'newPassword123',
            };

            await changePassword(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Contraseña actual incorrecta'
            });
        });
    });
}); 