import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { getSocialMetrics, getSocialPosts, getSocialInsights, publishPost, generateImage, uploadImage } from '../controllers/socialController.js';
import {
    listContent, createContent, importContent, updateContent, deleteContent,
    listCompetitors, addCompetitor, removeCompetitor, scanCompetitors,
    publishContentNow, scheduleContent, suggestContent, generateContentCalendar,
} from '../controllers/socialContentController.js';

const router = express.Router();

router.get('/metrics', protect, adminOnly, getSocialMetrics);
router.get('/insights/:platform', protect, adminOnly, getSocialInsights);
router.get('/posts/:platform', protect, adminOnly, getSocialPosts);
router.post('/publish', protect, adminOnly, publishPost);
router.post('/generate-image', protect, adminOnly, generateImage);
router.post('/upload-image', protect, adminOnly, uploadImage);

// Board de contenido (persistente en Mongo)
router.get('/content', protect, adminOnly, listContent);
router.post('/content', protect, adminOnly, createContent);
router.post('/content/import', protect, adminOnly, importContent);
router.put('/content/:id', protect, adminOnly, updateContent);
router.delete('/content/:id', protect, adminOnly, deleteContent);
router.post('/content/:id/publish', protect, adminOnly, publishContentNow);
router.patch('/content/:id/schedule', protect, adminOnly, scheduleContent);
router.post('/content/suggest', protect, adminOnly, suggestContent);
router.post('/content/calendar', protect, adminOnly, generateContentCalendar);

// Radar de competencia
router.get('/competitors', protect, adminOnly, listCompetitors);
router.post('/competitors', protect, adminOnly, addCompetitor);
router.delete('/competitors/:id', protect, adminOnly, removeCompetitor);
router.get('/competitors/scan', protect, adminOnly, scanCompetitors);

export default router;
