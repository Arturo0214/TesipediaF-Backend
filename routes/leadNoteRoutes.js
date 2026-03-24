import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { getNotes, createNote, deleteNote } from '../controllers/leadNoteController.js';

const router = express.Router();

router.use(protect);
router.use(adminOnly);

router.route('/:waId').get(getNotes).post(createNote);
router.route('/:noteId').delete(deleteNote);

export default router;
