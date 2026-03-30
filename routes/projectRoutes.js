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
    updateProject,
    createClientFromProject,
    migrateFixQuoteIndex,
    addRevision,
    updateRevisionStatus,
    getRevisions
} from '../controllers/projectController.js';
import { protect, admin, writer } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Admin routes
router.route('/')
    .post(protect, admin, createProjectFromQuote)
    .get(protect, admin, getAllProjects);

router.post('/manual', protect, admin, createManualProject);
router.post('/migrate-fix-index', protect, admin, migrateFixQuoteIndex);

router.route('/writer')
    .get(protect, writer, getWriterProjects);

router.route('/client')
    .get(protect, getClientProjects);

router.route('/:id')
    .get(protect, getProjectById)
    .put(protect, admin, updateProject);

router.route('/:id/create-client')
    .post(protect, admin, createClientFromProject);

router.route('/:id/assign')
    .put(protect, admin, assignWriter);

router.route('/:id/status')
    .put(protect, updateProjectStatus);

router.route('/:id/progress')
    .put(protect, writer, updateProgress);

router.route('/:id/comments')
    .post(protect, addComment);

// Revision / version routes
router.route('/:id/revisions')
    .get(protect, getRevisions)
    .post(protect, upload.single('file'), addRevision);

router.route('/:id/revisions/:version/status')
    .put(protect, admin, updateRevisionStatus);

export default router;