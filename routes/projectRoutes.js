import express from 'express';
import {
    createProjectFromQuote,
    createManualProject,
    getAllProjects,
    getWriterProjects,
    getClientProjects,
    getProjectById,
    assignWriter,
    updateProjectStatus,
    updateProgress,
    addComment,
    updateProject
} from '../controllers/projectController.js';
import { protect, admin, writer } from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin routes
router.route('/')
    .post(protect, admin, createProjectFromQuote)
    .get(protect, admin, getAllProjects);

router.post('/manual', protect, admin, createManualProject);

router.route('/writer')
    .get(protect, writer, getWriterProjects);

router.route('/client')
    .get(protect, getClientProjects);

router.route('/:id')
    .get(protect, getProjectById)
    .put(protect, admin, updateProject);

router.route('/:id/assign')
    .put(protect, admin, assignWriter);

router.route('/:id/status')
    .put(protect, updateProjectStatus);

router.route('/:id/progress')
    .put(protect, writer, updateProgress);

router.route('/:id/comments')
    .post(protect, addComment);

export default router; 