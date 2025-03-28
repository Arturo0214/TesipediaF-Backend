import express from 'express';
import { protect, admin } from '../middleware/auth.js';
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

const router = express.Router();

// Public routes
router.post('/', createQuote);
router.get('/public/:publicId', getQuoteByPublicId);

// Protected routes
router.use(protect);
router.get('/my-quotes', getMyQuotes);
router.post('/link/:publicId', linkQuoteToUser);

// Admin routes
router.use(admin);
router.get('/', getQuotes);
router.get('/search', searchQuotes);
router.get('/:id', getQuoteById);
router.put('/:id', updateQuote);
router.delete('/:id', deleteQuote);

export default router; 