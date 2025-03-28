import express from 'express';
import { sanitizeRequest } from '../middleware/sanitizer.js';

const router = express.Router();

// Apply sanitization middleware to all routes
router.use(sanitizeRequest);

// API version prefix
const API_VERSION = '/api/v1';

// Import route modules
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import orderRoutes from './order.routes.js';
import quoteRoutes from './quote.routes.js';
import paymentRoutes from './payment.routes.js';
import chatRoutes from './chat.routes.js';
import notificationRoutes from './notification.routes.js';
import adminRoutes from './admin.routes.js';
import visitRoutes from './visit.routes.js';

// Health check endpoint
router.get(`${API_VERSION}/health`, (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'API is healthy',
        timestamp: new Date().toISOString()
    });
});

// API documentation endpoint
router.get(`${API_VERSION}/docs`, (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'API documentation',
        endpoints: {
            auth: `${API_VERSION}/auth`,
            users: `${API_VERSION}/users`,
            orders: `${API_VERSION}/orders`,
            quotes: `${API_VERSION}/quotes`,
            payments: `${API_VERSION}/payments`,
            chat: `${API_VERSION}/chat`,
            notifications: `${API_VERSION}/notifications`,
            admin: `${API_VERSION}/admin`,
            visits: `${API_VERSION}/visits`
        }
    });
});

// Use route modules with version prefix
router.use(`${API_VERSION}/auth`, authRoutes);
router.use(`${API_VERSION}/users`, userRoutes);
router.use(`${API_VERSION}/orders`, orderRoutes);
router.use(`${API_VERSION}/quotes`, quoteRoutes);
router.use(`${API_VERSION}/payments`, paymentRoutes);
router.use(`${API_VERSION}/chat`, chatRoutes);
router.use(`${API_VERSION}/notifications`, notificationRoutes);
router.use(`${API_VERSION}/admin`, adminRoutes);
router.use(`${API_VERSION}/visits`, visitRoutes);

// 404 handler
router.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'Route not found',
        path: req.originalUrl
    });
});

export default router; 