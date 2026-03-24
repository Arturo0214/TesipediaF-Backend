import mongoose from 'mongoose';

const leadNoteSchema = new mongoose.Schema(
  {
    wa_id: {
      type: String,
      required: true,
      index: true,
    },
    author: {
      type: String,
      required: true, // nombre del admin que escribió la nota
    },
    content: {
      type: String,
      required: true,
      maxlength: 2000,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// Índice compuesto para buscar notas por wa_id ordenadas por fecha
leadNoteSchema.index({ wa_id: 1, createdAt: -1 });

const LeadNote = mongoose.model('LeadNote', leadNoteSchema);
export default LeadNote;
