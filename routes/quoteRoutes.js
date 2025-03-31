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
    searchQuotes
} from '../controllers/quoteController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import upload from '../middleware/multer.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Pública
router.post('/', uploadLimiter, upload.single('file'), createQuote);
router.get('/public/:publicId', getQuoteByPublicId);
router.put('/link/:publicId', protect, linkQuoteToUser);

// Privadas
router.get('/my-quotes', protect, getMyQuotes);

// Admin
router.get('/', protect, adminOnly, getQuotes);
router.get('/search', protect, adminOnly, searchQuotes);
router.get('/:id', protect, adminOnly, getQuoteById);
router.put('/:id', protect, adminOnly, updateQuote);
router.delete('/:id', protect, adminOnly, deleteQuote);

export default router;
