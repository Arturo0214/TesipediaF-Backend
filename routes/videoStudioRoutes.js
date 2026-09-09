import express from 'express';
import multer from 'multer';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getChannels, updateChannel, listVideos, getVideo, createVideo,
  updateVideo, deleteVideo, approveVideo, publishVideo, generateScript,
  listSocial, createSocial, updateSocial, approveSocial, discardSocial, uploadSocialImage,
  uploadSocialVideo, publishSocial, deleteSocial, sugerenciasSocial,
  getAutopublish, setAutopublish,
} from '../controllers/videoStudioController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadVid = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ── Admin: contenido de redes (imágenes, tabla contenido_social) ──
// Va ANTES de las rutas con /:id para que "social" no choque con un id.
router.get('/social/autopublish', protect, adminOnly, getAutopublish);
router.put('/social/autopublish', protect, adminOnly, setAutopublish);
router.get('/social', protect, adminOnly, listSocial);
router.post('/social', protect, adminOnly, createSocial);
router.patch('/social/:id', protect, adminOnly, updateSocial);
router.post('/social/:id/approve', protect, adminOnly, approveSocial);
router.post('/social/:id/discard', protect, adminOnly, discardSocial);
router.post('/social/:id/publish', protect, adminOnly, publishSocial);
router.post('/social/:id/sugerencias', protect, adminOnly, sugerenciasSocial);
router.delete('/social/:id', protect, adminOnly, deleteSocial);
router.post('/social/:id/imagen', protect, adminOnly, upload.single('imagen'), uploadSocialImage);
router.post('/social/:id/video', protect, adminOnly, uploadVid.single('video'), uploadSocialVideo);

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
