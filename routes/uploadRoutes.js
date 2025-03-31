import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    uploadFile,
    deleteFile,
    getFileInfo,
    getFileUrl,
    uploadMultipleFiles,
    getUploadHistory,
    getUploadStats
} from '../controllers/uploadController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// File management
router.post('/', uploadFile);
router.post('/multiple', uploadMultipleFiles);
router.delete('/:id', deleteFile);
router.get('/:id/info', getFileInfo);
router.get('/:id/url', getFileUrl);

// Upload history and stats
router.get('/history', getUploadHistory);
router.get('/stats', getUploadStats);

export default router; 