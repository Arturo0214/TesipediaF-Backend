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
      enum: ['Tesis', 'Tesina', 'Artículo', 'Ensayo', 'Proyecto de investigación', 'Otros'],
      required: true,
    },
    studyArea: {
      type: String,
      enum: [
        'Área 1: Ciencias Físico-Matemáticas y de las Ingenierías',
        'Área 2: Ciencias Biológicas, Químicas y de la Salud',
        'Área 3: Ciencias Sociales',
        'Área 4: Humanidades y Artes'
      ],
      required: true,
    },
    career: {
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
      minlength: [5, 'El título debe tener al menos 5 caracteres'],
    },
    requirements: {
      text: {
        type: String,
        minlength: [10, 'La descripción debe tener al menos 10 caracteres'],
      },
      file: {
        filename: String,
        originalname: String,
        mimetype: String,
        path: String,
        size: Number,
      },
    },
    pages: {
      type: Number,
      required: true,
      min: [1, 'Debe tener al menos una página'],
    },
    dueDate: {
      type: Date,
      required: true,
      validate: {
        validator: (date) => date > new Date(),
        message: 'La fecha debe ser futura',
      },
    },
    email: {
      type: String,
      required: true,
      match: [/^\S+@\S+\.\S+$/, 'Correo no válido'],
    },
    name: {
      type: String,
      required: true,
      minlength: [3, 'El nombre debe tener al menos 3 caracteres'],
    },
    phone: {
      type: String,
    },
    estimatedPrice: {
      type: Number,
    },
    priceDetails: {
      basePrice: {
        type: Number,
        required: true
      },
      urgencyCharge: {
        type: Number,
        default: 0
      },
      cashDiscount: {
        type: Number,
        default: 0
      },
      finalPrice: {
        type: Number,
        required: true
      }
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
