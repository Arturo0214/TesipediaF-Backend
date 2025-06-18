import asyncHandler from 'express-async-handler';
import { v4 as uuidv4 } from 'uuid';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import calculatePrice from '../utils/calculatePrice.js';
import cloudinary from '../config/cloudinary.js';
import crypto from 'crypto';
import GuestPayment from '../models/guestPayment.js';
import generateToken from '../utils/generateToken.js';
import stripe from '../config/stripe.js';

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

  // Validar teléfono si se proporciona
  if (phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
      res.status(400);
      throw new Error('El número de teléfono debe tener entre 8 y 15 dígitos');
    }
  }

  // Validar que la fecha sea futura
  if (new Date(dueDate) <= new Date()) {
    res.status(400);
    throw new Error('La fecha de entrega debe ser futura');
  }

  // Calcular el precio estimado
  const priceDetails = calculatePrice(studyArea, educationLevel, pages, dueDate);
  const estimatedPrice = priceDetails.precioTotal;

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
    priceDetails: {
      basePrice: priceDetails.precioBase,
      urgencyCharge: priceDetails.cargoUrgencia,
      cashDiscount: priceDetails.descuentoEfectivo,
      finalPrice: priceDetails.precioTotal
    },
    status: 'pending',
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
    quote: newQuote
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

  // Guardar los valores anteriores para comparar
  const previousValues = {
    studyArea: quote.studyArea,
    educationLevel: quote.educationLevel,
    pages: quote.pages,
    dueDate: quote.dueDate
  };

  // Actualizar campos
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
  if (req.body.status) quote.status = req.body.status;

  // Recalcular el precio si alguno de los campos relevantes cambió
  if (
    quote.studyArea !== previousValues.studyArea ||
    quote.educationLevel !== previousValues.educationLevel ||
    quote.pages !== previousValues.pages ||
    quote.dueDate !== previousValues.dueDate
  ) {
    const priceCalculation = calculatePrice(
      quote.studyArea,
      quote.educationLevel,
      quote.pages,
      quote.dueDate
    );

    // Asignar el precio total al campo estimatedPrice
    quote.estimatedPrice = priceCalculation.precioTotal;

    // Asignar los detalles de precios al campo priceDetails
    quote.priceDetails = {
      basePrice: priceCalculation.precioBase,
      urgencyCharge: priceCalculation.cargoUrgencia,
      cashDiscount: priceCalculation.descuentoEfectivo,
      finalPrice: priceCalculation.precioTotal
    };
  }

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

// 💰 Procesar pago de un invitado (sin login)
export const processGuestPayment = asyncHandler(async (req, res) => {
  const { quoteId, guestName, guestEmail, guestPhone, amount, paymentMethod } = req.body;

  if (!quoteId || !guestName || !guestEmail || !amount) {
    res.status(400);
    throw new Error('Faltan datos requeridos para el pago');
  }

  // Verificar que la cotización existe
  const quote = await Quote.findOne({ publicId: quoteId });
  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  // Generar token de seguimiento
  const trackingToken = crypto.randomBytes(32).toString('hex');

  // Crear registro de pago del invitado
  const guestPayment = await GuestPayment.create({
    quoteId,
    trackingToken,
    nombres: guestName.split(' ')[0] || 'Invitado',
    apellidos: guestName.split(' ').slice(1).join(' ') || 'Usuario',
    correo: guestEmail,
    amount,
    paymentMethod: 'stripe',
    paymentStatus: 'pending',
    paymentDetails: {
      guestPhone
    }
  });

  try {
    // Crear sesión de checkout con Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'mxn',
            product_data: {
              name: `Cotización: ${quote.taskTitle}`,
              description: `${quote.studyArea} - ${quote.educationLevel}`
            },
            unit_amount: Math.round(amount * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment/success?tracking_token=${trackingToken}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
      metadata: {
        trackingToken,
        quoteId,
        guestName,
        guestEmail
      }
    });

    // Actualizar detalles del pago
    guestPayment.paymentDetails = {
      id: session.id,
      url: session.url
    };
    guestPayment.paymentStatus = 'pending';
    await guestPayment.save();

    res.status(200).json({
      message: 'Sesión de pago creada correctamente',
      trackingToken,
      sessionId: session.id,
      sessionUrl: session.url
    });
  } catch (error) {
    console.error('Error al procesar pago de invitado:', error);
    res.status(500);
    throw new Error('Error al procesar el pago: ' + error.message);
  }
});

// 🔍 Verificar estado de pago como invitado
export const checkGuestPaymentStatus = async (req, res) => {
  try {
    const { trackingToken } = req.params;

    const payment = await GuestPayment.findOne({ trackingToken });
    if (!payment) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    res.status(200).json({
      status: payment.paymentStatus,
      amount: payment.amount,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt
    });
  } catch (error) {
    console.error('Error al verificar estado del pago:', error);
    res.status(500).json({ message: 'Error al verificar el estado del pago' });
  }
};

// 🔄 Actualizar cotización pública
export const updatePublicQuote = asyncHandler(async (req, res) => {
  const quote = await Quote.findOne({ publicId: req.params.publicId });
  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  // Guardar los valores anteriores para comparar
  const previousValues = {
    studyArea: quote.studyArea,
    educationLevel: quote.educationLevel,
    pages: quote.pages,
    dueDate: quote.dueDate
  };

  // Actualizar campos
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
  if (req.body.status) quote.status = req.body.status;

  // Recalcular el precio si alguno de los campos relevantes cambió
  if (
    quote.studyArea !== previousValues.studyArea ||
    quote.educationLevel !== previousValues.educationLevel ||
    quote.pages !== previousValues.pages ||
    quote.dueDate !== previousValues.dueDate
  ) {
    const priceCalculation = calculatePrice(
      quote.studyArea,
      quote.educationLevel,
      quote.pages,
      quote.dueDate
    );

    // Asignar el precio total al campo estimatedPrice
    quote.estimatedPrice = priceCalculation.precioTotal;

    // Asignar los detalles de precios al campo priceDetails
    quote.priceDetails = {
      basePrice: priceCalculation.precioBase,
      urgencyCharge: priceCalculation.cargoUrgencia,
      cashDiscount: priceCalculation.descuentoEfectivo,
      finalPrice: priceCalculation.precioTotal
    };
  }

  const updatedQuote = await quote.save();
  res.json(updatedQuote);
});
