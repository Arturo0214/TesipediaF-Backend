import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    createQuote,
    getQuoteByPublicId,
    getMyQuotes,
    linkQuoteToUser,
    getQuotes,
    getQuoteById,
    updateQuote,
    deleteQuote,
    searchQuotes,
} from '../controllers/quoteController.js';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import calculatePrice from '../utils/calculatePrice.js';

// Mock de los modelos
jest.mock('../models/Quote.js');
jest.mock('../models/Notification.js');
jest.mock('../utils/calculatePrice.js');

describe('Quote Controller', () => {
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

    describe('createQuote', () => {
        it('should create a new quote', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                publicId: 'test-quote',
                taskType: 'Test Type',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                taskTitle: 'Test Task',
                requirements: 'Test Requirements',
                pages: 10,
                dueDate: new Date(),
                email: 'test@example.com',
                whatsApp: '1234567890',
                estimatedPrice: 100,
            };

            Quote.create = jest.fn().mockResolvedValue(mockQuote);
            Notification.create = jest.fn().mockResolvedValue({});

            mockReq.body = {
                taskType: 'Test Type',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                taskTitle: 'Test Task',
                requirements: 'Test Requirements',
                pages: 10,
                dueDate: new Date(),
                email: 'test@example.com',
                whatsApp: '1234567890',
            };

            await createQuote(mockReq, mockRes);
            expect(calculatePrice).toHaveBeenCalledWith('Test Area', 'Test Level', 10);
            expect(Quote.create).toHaveBeenCalledWith({
                publicId: expect.any(String),
                taskType: 'Test Type',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                taskTitle: 'Test Task',
                requirements: 'Test Requirements',
                pages: 10,
                dueDate: expect.any(Date),
                email: 'test@example.com',
                whatsApp: '1234567890',
                estimatedPrice: 100,
            });
            expect(Notification.create).toHaveBeenCalledWith({
                user: process.env.SUPER_ADMIN_ID,
                type: 'cotizacion',
                message: expect.stringContaining('Nueva cotización pública creada'),
                data: {
                    quoteId: mockQuote._id,
                    email: 'test@example.com',
                },
            });
            expect(mockRes.status(201).json).toHaveBeenCalledWith({
                message: 'Cotización creada exitosamente',
                quote: {
                    publicId: mockQuote.publicId,
                    estimatedPrice: 100,
                },
            });
        });

        it('should return error if required fields are missing', async () => {
            mockReq.body = {
                taskType: 'Test Type',
            };

            await createQuote(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Faltan datos obligatorios'
            });
        });
    });

    describe('getQuoteByPublicId', () => {
        it('should get quote by public id', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                publicId: 'test-quote',
                taskType: 'Test Type',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                taskTitle: 'Test Task',
                requirements: 'Test Requirements',
                pages: 10,
                dueDate: new Date(),
                email: 'test@example.com',
                whatsApp: '1234567890',
                estimatedPrice: 100,
            };

            Quote.findOne = jest.fn().mockResolvedValue(mockQuote);

            mockReq.params.publicId = 'test-quote';

            await getQuoteByPublicId(mockReq, mockRes);
            expect(Quote.findOne).toHaveBeenCalledWith({ publicId: 'test-quote' });
            expect(mockRes.json).toHaveBeenCalledWith(mockQuote);
        });

        it('should return error if quote not found', async () => {
            Quote.findOne = jest.fn().mockResolvedValue(null);

            mockReq.params.publicId = 'nonexistent-quote';

            await getQuoteByPublicId(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización no encontrada'
            });
        });
    });

    describe('getMyQuotes', () => {
        it('should get user quotes', async () => {
            const mockQuotes = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    user: mockReq.user._id,
                    taskType: 'Test Type',
                    studyArea: 'Test Area',
                    educationLevel: 'Test Level',
                    taskTitle: 'Test Task',
                    requirements: 'Test Requirements',
                    pages: 10,
                    dueDate: new Date(),
                    email: 'test@example.com',
                    whatsApp: '1234567890',
                    estimatedPrice: 100,
                },
            ];

            Quote.find = jest.fn().mockResolvedValue(mockQuotes);

            await getMyQuotes(mockReq, mockRes);
            expect(Quote.find).toHaveBeenCalledWith({ user: mockReq.user._id });
            expect(mockRes.json).toHaveBeenCalledWith(mockQuotes);
        });
    });

    describe('linkQuoteToUser', () => {
        it('should link quote to user', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                publicId: 'test-quote',
                user: null,
                save: jest.fn().mockResolvedValue({
                    _id: mockQuote._id,
                    user: mockReq.user._id,
                }),
            };

            Quote.findOne = jest.fn().mockResolvedValue(mockQuote);

            mockReq.params.publicId = 'test-quote';

            await linkQuoteToUser(mockReq, mockRes);
            expect(Quote.findOne).toHaveBeenCalledWith({ publicId: 'test-quote' });
            expect(mockQuote.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización vinculada correctamente',
                quote: expect.any(Object),
            });
        });

        it('should return error if quote not found', async () => {
            Quote.findOne = jest.fn().mockResolvedValue(null);

            mockReq.params.publicId = 'nonexistent-quote';

            await linkQuoteToUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización no encontrada'
            });
        });

        it('should return error if quote already linked', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                publicId: 'test-quote',
                user: new mongoose.Types.ObjectId(), // Already linked
            };

            Quote.findOne = jest.fn().mockResolvedValue(mockQuote);

            mockReq.params.publicId = 'test-quote';

            await linkQuoteToUser(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Esta cotización ya está vinculada a una cuenta'
            });
        });
    });

    describe('getQuotes', () => {
        it('should get all quotes for admin', async () => {
            const mockQuotes = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    user: new mongoose.Types.ObjectId(),
                    taskType: 'Test Type',
                    studyArea: 'Test Area',
                    educationLevel: 'Test Level',
                    taskTitle: 'Test Task',
                    requirements: 'Test Requirements',
                    pages: 10,
                    dueDate: new Date(),
                    email: 'test@example.com',
                    whatsApp: '1234567890',
                    estimatedPrice: 100,
                },
            ];

            mockReq.user.role = 'admin';
            Quote.find = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockQuotes),
            });

            await getQuotes(mockReq, mockRes);
            expect(Quote.find).toHaveBeenCalledWith({});
            expect(mockRes.json).toHaveBeenCalledWith(mockQuotes);
        });
    });

    describe('getQuoteById', () => {
        it('should get quote by id for admin', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                user: new mongoose.Types.ObjectId(),
                taskType: 'Test Type',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                taskTitle: 'Test Task',
                requirements: 'Test Requirements',
                pages: 10,
                dueDate: new Date(),
                email: 'test@example.com',
                whatsApp: '1234567890',
                estimatedPrice: 100,
            };

            Quote.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockQuote),
            });

            mockReq.params.id = mockQuote._id.toString();

            await getQuoteById(mockReq, mockRes);
            expect(Quote.findById).toHaveBeenCalledWith(mockQuote._id);
            expect(mockRes.json).toHaveBeenCalledWith(mockQuote);
        });

        it('should return error if quote not found', async () => {
            Quote.findById = jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(null),
            });

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await getQuoteById(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización no encontrada'
            });
        });
    });

    describe('updateQuote', () => {
        it('should update quote', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                taskType: 'Test Type',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                taskTitle: 'Test Task',
                requirements: 'Test Requirements',
                pages: 10,
                dueDate: new Date(),
                email: 'test@example.com',
                whatsApp: '1234567890',
                status: 'pending',
                save: jest.fn().mockResolvedValue({
                    _id: mockQuote._id,
                    taskType: 'Updated Type',
                    status: 'completed',
                }),
            };

            Quote.findById = jest.fn().mockResolvedValue(mockQuote);

            mockReq.params.id = mockQuote._id.toString();
            mockReq.body = {
                taskType: 'Updated Type',
                status: 'completed',
            };

            await updateQuote(mockReq, mockRes);
            expect(Quote.findById).toHaveBeenCalledWith(mockQuote._id);
            expect(mockQuote.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    taskType: 'Updated Type',
                    status: 'completed',
                })
            );
        });

        it('should return error if quote not found', async () => {
            Quote.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body = {
                taskType: 'Updated Type',
                status: 'completed',
            };

            await updateQuote(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización no encontrada'
            });
        });
    });

    describe('deleteQuote', () => {
        it('should delete quote', async () => {
            const mockQuote = {
                _id: new mongoose.Types.ObjectId(),
                taskType: 'Test Type',
                studyArea: 'Test Area',
                educationLevel: 'Test Level',
                taskTitle: 'Test Task',
                requirements: 'Test Requirements',
                pages: 10,
                dueDate: new Date(),
                email: 'test@example.com',
                whatsApp: '1234567890',
                deleteOne: jest.fn().mockResolvedValue({}),
            };

            Quote.findById = jest.fn().mockResolvedValue(mockQuote);

            mockReq.params.id = mockQuote._id.toString();

            await deleteQuote(mockReq, mockRes);
            expect(Quote.findById).toHaveBeenCalledWith(mockQuote._id);
            expect(mockQuote.deleteOne).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización eliminada correctamente'
            });
        });

        it('should return error if quote not found', async () => {
            Quote.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();

            await deleteQuote(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Cotización no encontrada'
            });
        });
    });

    describe('searchQuotes', () => {
        it('should search quotes', async () => {
            const mockQuotes = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    taskType: 'Test Type',
                    studyArea: 'Test Area',
                    taskTitle: 'Test Task',
                },
            ];

            const mockQuery = {
                populate: jest.fn().mockResolvedValue(mockQuotes),
            };

            Quote.find = jest.fn().mockReturnValue(mockQuery);

            mockReq.query.query = 'test';

            await searchQuotes(mockReq, mockRes);
            expect(Quote.find).toHaveBeenCalledWith({
                $or: [
                    { taskTitle: { $regex: 'test', $options: 'i' } },
                    { studyArea: { $regex: 'test', $options: 'i' } },
                    { taskType: { $regex: 'test', $options: 'i' } },
                ],
            });
            expect(mockQuery.populate).toHaveBeenCalledWith('user', 'name email');
            expect(mockRes.json).toHaveBeenCalledWith(mockQuotes);
        });
    });
}); 