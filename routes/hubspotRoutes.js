import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { getDeals, getContacts, getPipelines, getSummary } from '../controllers/hubspotController.js';

const router = express.Router();

router.use(protect, adminOnly);

router.get('/deals', getDeals);
router.get('/contacts', getContacts);
router.get('/pipelines', getPipelines);
router.get('/summary', getSummary);

export default router;
