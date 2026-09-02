import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getChannels, updateChannel, listVideos, getVideo, createVideo,
  updateVideo, deleteVideo, approveVideo, publishVideo, generateScript,
} from '../controllers/videoStudioController.js';

const router = express.Router();

// ── Admin: destinos (canales) ──
router.get('/channels', protect, adminOnly, getChannels);
router.patch('/channels/:id', protect, adminOnly, updateChannel);

// ── Admin: cola de contenido ──
router.get('/', protect, adminOnly, listVideos);
router.post('/', protect, adminOnly, createVideo);
router.post('/generate', protect, adminOnly, generateScript);
router.get('/:id', protect, adminOnly, getVideo);
router.patch('/:id', protect, adminOnly, updateVideo);
router.delete('/:id', protect, adminOnly, deleteVideo);
router.post('/:id/approve', protect, adminOnly, approveVideo);
router.post('/:id/publish', protect, adminOnly, publishVideo);

export default router;
