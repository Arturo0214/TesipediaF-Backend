import asyncHandler from 'express-async-handler';
import { v4 as uuidv4 } from 'uuid';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import calculatePrice from '../utils/calculatePrice.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// 📝 Crear cotización pública (sin login)
export const createQuote = asyncHandler(async (req, res) => {
  const {
    taskType,
    studyArea,
    educationLevel,
    taskTitle,
    requirements,
    pages,
    dueDate,
    email,
    whatsApp,
  } = req.body;

  if (!taskType || !studyArea || !educationLevel || !pages || !dueDate || !email) {
    res.status(400);
    throw new Error('Faltan datos obligatorios');
  }

  const estimatedPrice = calculatePrice(studyArea, educationLevel, pages);

  const newQuote = await Quote.create({
    publicId: uuidv4(),
    taskType,
    studyArea,
    educationLevel,
    taskTitle,
    requirements,
    pages,
    dueDate,
    email,
    whatsApp,
    estimatedPrice,
  });

  await Notification.create({
    user: SUPER_ADMIN_ID,
    type: 'cotizacion',
    message: `📝 Nueva cotización pública creada (${studyArea})`,
    data: {
      quoteId: newQuote._id,
      email,
    },
  });
  
  res.status(201).json({
    message: 'Cotización creada exitosamente',
    quote: {
      publicId: newQuote.publicId,
      estimatedPrice,
    },
  });
});
// 🔎 Ver cotización pública
export const getQuoteByPublicId = asyncHandler(async (req, res) => {
  const quote = await Quote.findOne({ publicId: req.params.publicId });

  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  res.json(quote);
});

// 🔒 Obtener mis cotizaciones (usuario logueado)
export const getMyQuotes = asyncHandler(async (req, res) => {
  const quotes = await Quote.find({ user: req.user._id });
  res.json(quotes);
});

// 🔗 Asociar cotización a usuario después del registro
export const linkQuoteToUser = asyncHandler(async (req, res) => {
  const quote = await Quote.findOne({ publicId: req.params.publicId });

  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  if (quote.user) {
    res.status(400);
    throw new Error('Esta cotización ya está vinculada a una cuenta');
  }

  quote.user = req.user._id;
  await quote.save();

  res.json({ message: 'Cotización vinculada correctamente', quote });
});
