import mongoose from 'mongoose';

const quoteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    publicId: {
      type: String,
      required: true,
      unique: true,
    },
    taskType: {
      type: String,
      enum: ['Tesis', 'Tesina', 'Artículo', 'Ensayo'],
      required: true,
    },
    studyArea: {
      type: String,
      required: true,
    },
    educationLevel: {
      type: String,
      enum: ['Licenciatura', 'Maestría', 'Doctorado'],
      required: true,
    },
    taskTitle: {
      type: String,
    },
    requirements: {
      text: String,
      file: String,
    },
    pages: {
      type: Number, // unificamos nombre con Order
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    whatsApp: {
      type: String,
    },
    estimatedPrice: {
      type: Number,
    },
    convertedToOrder: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const Quote = mongoose.model('Quote', quoteSchema);
export default Quote;
