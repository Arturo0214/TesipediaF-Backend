import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
    trackVisit,
    updateVisit,
} from '../controllers/visitController.js';
import Visit from '../models/Visit.js';

// Mock del modelo
jest.mock('../models/Visit.js');

describe('Visit Controller', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            body: {},
            params: {},
            headers: {
                'x-forwarded-for': '127.0.0.1',
                'user-agent': 'Mozilla/5.0',
            },
            get: jest.fn().mockReturnValue('Mozilla/5.0'),
            originalUrl: '/test',
            socket: {
                remoteAddress: '127.0.0.1'
            }
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

    describe('trackVisit', () => {
        it('should create a new visit', async () => {
            const mockVisit = {
                _id: new mongoose.Types.ObjectId(),
                path: '/test',
                ip: '127.0.0.1',
                userAgent: 'Mozilla/5.0',
                timestamp: new Date(),
            };

            Visit.create = jest.fn().mockResolvedValue(mockVisit);

            mockReq.body = {
                path: '/test',
            };

            await trackVisit(mockReq, mockRes);
            expect(Visit.create).toHaveBeenCalledWith({
                path: '/test',
                ip: '127.0.0.1',
                userAgent: 'Mozilla/5.0',
                timestamp: expect.any(Date),
            });
            expect(mockRes.status(201).json).toHaveBeenCalledWith(mockVisit);
        });

        it('should return error if required fields are missing', async () => {
            mockReq.body = {
                path: '/test',
            };

            await trackVisit(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Se requiere path'
            });
        });
    });

    describe('updateVisit', () => {
        it('should update visit details', async () => {
            const mockVisitId = new mongoose.Types.ObjectId();
            const mockVisit = {
                _id: mockVisitId,
                path: '/test',
                ip: '127.0.0.1',
                userAgent: 'Mozilla/5.0',
                timestamp: new Date(),
                save: jest.fn().mockResolvedValue({
                    _id: mockVisitId,
                    path: '/updated',
                    ip: '127.0.0.1',
                    userAgent: 'Mozilla/5.0',
                }),
            };

            Visit.findById = jest.fn().mockResolvedValue(mockVisit);

            mockReq.params.id = mockVisitId.toString();
            mockReq.body = {
                path: '/updated',
            };

            await updateVisit(mockReq, mockRes);
            expect(Visit.findById).toHaveBeenCalledWith(mockVisitId);
            expect(mockVisit.save).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: expect.any(mongoose.Types.ObjectId),
                    path: '/updated',
                    ip: '127.0.0.1',
                    userAgent: 'Mozilla/5.0',
                })
            );
        });

        it('should return error if visit not found', async () => {
            Visit.findById = jest.fn().mockResolvedValue(null);

            mockReq.params.id = new mongoose.Types.ObjectId().toString();
            mockReq.body = {
                path: '/updated',
            };

            await updateVisit(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Visita no encontrada'
            });
        });
    });
}); 