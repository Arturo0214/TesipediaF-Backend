import express from 'express';
import multer from 'multer';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getChannels, listVideos, getVideo, createVideo, updateVideo, deleteVideo,
  enqueueRender, approveVideo, publishVideo, generateScript,
  workerNext, workerComplete, workerError,
} from '../controllers/videoStudioController.js';

const router = express.Router();

// Multer en memoria para recibir el mp4 renderizado por el worker (hasta 80MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

// Auth del worker local por token compartido (no requiere login de usuario)
const workerAuth = (req, res, next) => {
  const token = req.headers['x-worker-token'];
  if (!process.env.VIDEO_WORKER_TOKEN || token !== process.env.VIDEO_WORKER_TOKEN) {
    return res.status(401).json({ message: 'worker no autorizado' });
  }
  next();
};

// ── Worker (token) ──
router.get('/worker/next', workerAuth, workerNext);
router.post('/worker/:id/complete', workerAuth,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  workerComplete);
router.post('/worker/:id/error', workerAuth, workerError);

// ── Admin ──
router.get('/channels', protect, adminOnly, getChannels);
router.get('/', protect, adminOnly, listVideos);
router.post('/', protect, adminOnly, createVideo);
router.post('/generate', protect, adminOnly, generateScript);
router.get('/:id', protect, adminOnly, getVideo);
router.patch('/:id', protect, adminOnly, updateVideo);
router.delete('/:id', protect, adminOnly, deleteVideo);
router.post('/:id/enqueue', protect, adminOnly, enqueueRender);
router.post('/:id/approve', protect, adminOnly, approveVideo);
router.post('/:id/publish', protect, adminOnly, publishVideo);

export default router;
