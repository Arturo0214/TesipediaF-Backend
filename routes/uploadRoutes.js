import express from 'express';
import upload from '../middleware/uploadMiddleware.js';
import { uploadFiles } from '../controllers/uploadController.js';
import { protect } from '../middleware/authMiddleware.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// 📤 Subida protegida
router.post('/', protect, uploadLimiter, upload.array('files', 5), uploadFiles);

export default router;
