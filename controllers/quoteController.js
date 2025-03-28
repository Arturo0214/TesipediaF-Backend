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

// 📋 Obtener todas las cotizaciones (admin)
export const getQuotes = asyncHandler(async (req, res) => {
  const quotes = await Quote.find({}).populate('user', 'name email');
  res.json(quotes);
});

// 🔍 Obtener cotización por ID (admin)
export const getQuoteById = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id).populate('user', 'name email');
  if (quote) {
    res.json(quote);
  } else {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }
});

// 🔄 Actualizar cotización (admin)
export const updateQuote = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id);

  if (quote) {
    quote.taskType = req.body.taskType || quote.taskType;
    quote.studyArea = req.body.studyArea || quote.studyArea;
    quote.educationLevel = req.body.educationLevel || quote.educationLevel;
    quote.taskTitle = req.body.taskTitle || quote.taskTitle;
    quote.requirements = req.body.requirements || quote.requirements;
    quote.pages = req.body.pages || quote.pages;
    quote.dueDate = req.body.dueDate || quote.dueDate;
    quote.email = req.body.email || quote.email;
    quote.whatsApp = req.body.whatsApp || quote.whatsApp;
    quote.status = req.body.status || quote.status;

    const updatedQuote = await quote.save();
    res.json(updatedQuote);
  } else {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }
});

// ❌ Eliminar cotización (admin)
export const deleteQuote = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id);

  if (quote) {
    await quote.deleteOne();
    res.json({ message: 'Cotización eliminada correctamente' });
  } else {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }
});

// 🔍 Buscar cotizaciones
export const searchQuotes = asyncHandler(async (req, res) => {
  const { query } = req.query;
  const quotes = await Quote.find({
    $or: [
      { taskTitle: { $regex: query, $options: 'i' } },
      { studyArea: { $regex: query, $options: 'i' } },
      { taskType: { $regex: query, $options: 'i' } },
    ],
  }).populate('user', 'name email');
  res.json(quotes);
});
