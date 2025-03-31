import asyncHandler from 'express-async-handler';
import { v4 as uuidv4 } from 'uuid';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import calculatePrice from '../utils/calculatePrice.js';
import cloudinary from '../config/cloudinary.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// 📝 Crear cotización pública
export const createQuote = asyncHandler(async (req, res) => {
  const {
    taskType,
    studyArea,
    career,
    educationLevel,
    taskTitle,
    pages,
    dueDate,
    email,
    name,
    phone,
  } = req.body;

  const text = req.body.descripcion || req.body.requirements?.text;

  // Crear un objeto para rastrear los campos faltantes
  const missingFields = [];

  // Validar cada campo requerido
  if (!taskType) missingFields.push('Tipo de tesis');
  if (!studyArea) missingFields.push('Área de estudio');
  if (!career) missingFields.push('Carrera');
  if (!educationLevel) missingFields.push('Nivel académico');
  if (!taskTitle) missingFields.push('Título del trabajo');
  if (!pages) missingFields.push('Número de páginas');
  if (!dueDate) missingFields.push('Fecha de entrega');
  if (!email) missingFields.push('Email');
  if (!name) missingFields.push('Nombre');
  if (!text) missingFields.push('Descripción del proyecto');

  // Si hay campos faltantes, enviar error con la lista de campos
  if (missingFields.length > 0) {
    res.status(400);
    throw new Error(`Faltan los siguientes campos obligatorios: ${missingFields.join(', ')}`);
  }

  // Validaciones adicionales
  if (taskTitle.length < 5) {
    res.status(400);
    throw new Error('El título debe tener al menos 5 caracteres');
  }

  if (text.length < 10) {
    res.status(400);
    throw new Error('La descripción debe tener al menos 10 caracteres');
  }

  if (name.length < 3) {
    res.status(400);
    throw new Error('El nombre debe tener al menos 3 caracteres');
  }

  // Validar email
  const emailRegex = /^\S+@\S+\.\S+$/;
  if (!emailRegex.test(email)) {
    res.status(400);
    throw new Error('El formato del email no es válido');
  }

  // Validar que la fecha sea futura
  if (new Date(dueDate) <= new Date()) {
    res.status(400);
    throw new Error('La fecha de entrega debe ser futura');
  }

  const estimatedPrice = calculatePrice(studyArea, educationLevel, pages);

  let fileData;
  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'quotes',
    });

    fileData = {
      filename: result.public_id,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: result.secure_url,
      size: req.file.size,
    };
  }

  const newQuote = await Quote.create({
    publicId: uuidv4(),
    taskType,
    studyArea,
    career,
    educationLevel,
    taskTitle,
    requirements: {
      text,
      file: fileData,
    },
    pages,
    dueDate,
    email,
    name,
    phone,
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

// 🔒 Obtener mis cotizaciones
export const getMyQuotes = asyncHandler(async (req, res) => {
  const quotes = await Quote.find({ user: req.user._id });
  res.json(quotes);
});

// 🔗 Asociar cotización a usuario
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
  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  quote.taskType = req.body.taskType || quote.taskType;
  quote.studyArea = req.body.studyArea || quote.studyArea;
  quote.career = req.body.career || quote.career;
  quote.educationLevel = req.body.educationLevel || quote.educationLevel;
  quote.taskTitle = req.body.taskTitle || quote.taskTitle;
  quote.requirements = req.body.requirements || quote.requirements;
  quote.pages = req.body.pages || quote.pages;
  quote.dueDate = req.body.dueDate || quote.dueDate;
  quote.email = req.body.email || quote.email;
  quote.name = req.body.name || quote.name;
  quote.phone = req.body.phone || quote.phone;
  quote.status = req.body.status || quote.status;

  const updatedQuote = await quote.save();
  res.json(updatedQuote);
});

// ❌ Eliminar cotización (admin)
export const deleteQuote = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id);
  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  await quote.deleteOne();
  res.json({ message: 'Cotización eliminada correctamente' });
});

// 🔍 Buscar cotizaciones
export const searchQuotes = asyncHandler(async (req, res) => {
  const { query } = req.query;
  const quotes = await Quote.find({
    $or: [
      { taskTitle: { $regex: query, $options: 'i' } },
      { studyArea: { $regex: query, $options: 'i' } },
      { taskType: { $regex: query, $options: 'i' } },
      { career: { $regex: query, $options: 'i' } },
      { name: { $regex: query, $options: 'i' } },
    ],
  }).populate('user', 'name email');
  res.json(quotes);
});
