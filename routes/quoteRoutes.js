import express from 'express';
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
    processGuestPayment,
    checkGuestPaymentStatus,
    updatePublicQuote,
    updateMyQuote
} from '../controllers/quoteController.js';
import { protect, adminOnly, optionalAuth } from '../middleware/authMiddleware.js';
import upload from '../middleware/multer.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Pública (con autenticación opcional)
router.post('/', optionalAuth, uploadLimiter, upload.single('file'), createQuote);
router.get('/public/:publicId', getQuoteByPublicId);
router.put('/public/:publicId', updatePublicQuote);
router.put('/link/:publicId', protect, linkQuoteToUser);

// Rutas públicas para pago como invitado
router.post('/process-guest-payment', processGuestPayment);
router.get('/check-guest-payment/:trackingToken', checkGuestPaymentStatus);

// Privadas
router.get('/my-quotes', protect, getMyQuotes);
router.put('/my-quotes/:id', protect, updateMyQuote);

// Admin
router.get('/', protect, adminOnly, getQuotes);
router.get('/search', protect, adminOnly, searchQuotes);
router.get('/:id', protect, adminOnly, getQuoteById);
router.put('/:id', protect, adminOnly, updateQuote);
router.delete('/:id', protect, adminOnly, deleteQuote);

export default router;
