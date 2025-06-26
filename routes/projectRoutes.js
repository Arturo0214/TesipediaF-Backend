import express from 'express';
import {
    createProjectFromQuote,
    getAllProjects,
    getWriterProjects,
    getClientProjects,
    getProjectById,
    assignWriter,
    updateProjectStatus,
    updateProgress,
    addComment
} from '../controllers/projectController.js';
import { protect, admin, writer } from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin routes
router.route('/')
    .post(protect, admin, createProjectFromQuote)
    .get(protect, admin, getAllProjects);

router.route('/writer')
    .get(protect, writer, getWriterProjects);

router.route('/client')
    .get(protect, getClientProjects);

router.route('/:id')
    .get(protect, getProjectById);

router.route('/:id/assign')
    .put(protect, admin, assignWriter);

router.route('/:id/status')
    .put(protect, updateProjectStatus);

router.route('/:id/progress')
    .put(protect, writer, updateProgress);

router.route('/:id/comments')
    .post(protect, addComment);

export default router; 