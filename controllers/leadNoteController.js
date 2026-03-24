import LeadNote from '../models/LeadNote.js';
import asyncHandler from 'express-async-handler';

// @desc    Get all notes for a lead
// @route   GET /api/v1/lead-notes/:waId
// @access  Admin
export const getNotes = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const notes = await LeadNote.find({ wa_id: waId }).sort({ createdAt: -1 });
  res.json(notes);
});

// @desc    Create a note for a lead
// @route   POST /api/v1/lead-notes/:waId
// @access  Admin
export const createNote = asyncHandler(async (req, res) => {
  const { waId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    res.status(400);
    throw new Error('El contenido de la nota es requerido');
  }

  const author = req.user?.name || req.user?.email || 'Admin';

  const note = await LeadNote.create({
    wa_id: waId,
    author,
    content: content.trim(),
  });

  res.status(201).json(note);
});

// @desc    Delete a note
// @route   DELETE /api/v1/lead-notes/:noteId
// @access  Admin
export const deleteNote = asyncHandler(async (req, res) => {
  const { noteId } = req.params;
  const note = await LeadNote.findByIdAndDelete(noteId);

  if (!note) {
    res.status(404);
    throw new Error('Nota no encontrada');
  }

  res.json({ message: 'Nota eliminada' });
});
