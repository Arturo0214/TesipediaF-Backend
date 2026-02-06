import asyncHandler from 'express-async-handler';
import { v4 as uuidv4 } from 'uuid';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import calculatePrice from '../utils/calculatePrice.js';
import cloudinary from '../config/cloudinary.js';
import crypto from 'crypto';
import GuestPayment from '../models/guestPayment.js';
import stripe from '../config/stripe.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// 📝 Crear cotización pública
export const createQuote = asyncHandler(async (req, res) => {
  // Log de autenticación
  console.log('Estado de autenticación:', {
    isAuthenticated: !!req.user,
    userId: req.user?._id,
    userEmail: req.user?.email,
    userRole: req.user?.role
  });

  console.log('Datos recibidos:', req.body);

  const taskType = req.body.taskType || req.body.tipoTesis;
  const studyArea = req.body.studyArea || req.body.areaEstudio;
  const career = req.body.career || req.body.carrera;
  const educationLevel = req.body.educationLevel || req.body.nivelAcademico;
  const taskTitle = req.body.taskTitle || req.body.tema;
  const pages = req.body.pages || req.body.numPaginas;
  const dueDate = req.body.dueDate || req.body.fechaEntrega;
  const email = req.body.email || req.body.correo;
  const name = req.body.name || req.body.nombre;
  const phone = req.body.phone || req.body.telefono;
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
  const priceDetails = calculatePrice(studyArea, educationLevel, parseInt(pages), dueDate, 'card', taskType);

  if (!priceDetails || typeof priceDetails.precioTotal !== 'number') {
    console.error('Error en el cálculo del precio:', priceDetails);
    res.status(500);
    throw new Error('Error al calcular el precio de la cotización');
  }

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

  const quoteData = {
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
    pages: parseInt(pages),
    dueDate,
    email,
    name,
    phone,
    estimatedPrice: priceDetails.precioTotal,
    priceDetails: {
      basePrice: priceDetails.precioBase,
      urgencyCharge: priceDetails.cargoUrgencia,
      cashDiscount: priceDetails.descuentoEfectivo,
      finalPrice: priceDetails.precioTotal
    },
    status: 'pending',
    user: req.user?._id || null
  };

  console.log('Creando cotización con datos:', {
    ...quoteData,
    estimatedPrice: priceDetails.precioTotal,
    userAssigned: req.user ? req.user._id : 'No user authenticated'
  });

  const newQuote = await Quote.create(quoteData);

  // Log después de crear la cotización
  console.log('Cotización creada:', {
    quoteId: newQuote._id,
    publicId: newQuote.publicId,
    userId: newQuote.user,
    estimatedPrice: newQuote.estimatedPrice
  });

  // Verificar que la cotización se creó correctamente con el precio
  if (!newQuote.estimatedPrice || newQuote.estimatedPrice === 0) {
    console.error('Cotización creada sin precio:', newQuote);
    res.status(500);
    throw new Error('Error al guardar el precio de la cotización');
  }

  // Crear notificación solo si hay un usuario administrador
  if (SUPER_ADMIN_ID) {
    await Notification.create({
      user: SUPER_ADMIN_ID,
      type: 'cotizacion',
      message: `📝 Nueva cotización ${req.user ? 'creada por usuario registrado' : 'pública'} (${studyArea})`,
      data: {
        quoteId: newQuote._id,
        email,
      },
    });
  }

  // Enviar respuesta con todos los detalles necesarios
  res.status(201).json({
    message: 'Cotización creada exitosamente',
    quote: {
      ...newQuote.toObject(),
      estimatedPrice: priceDetails.precioTotal,
      priceDetails: {
        basePrice: priceDetails.precioBase,
        urgencyCharge: priceDetails.cargoUrgencia,
        cashDiscount: priceDetails.descuentoEfectivo,
        finalPrice: priceDetails.precioTotal
      }
    }
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
    dueDate: quote.dueDate,
    user: quote.user // Preservar el usuario
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

  // Asegurarse de que el usuario se mantenga
  quote.user = previousValues.user;

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
      quote.dueDate,
      'card',
      quote.taskType
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

  // Log para verificar que el usuario se mantiene
  console.log('Quote updated with user:', {
    quoteId: updatedQuote._id,
    userId: updatedQuote.user
  });

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

// 🔄 Actualizar mi cotización (usuario autenticado)
export const updateMyQuote = asyncHandler(async (req, res) => {
  const quote = await Quote.findOne({ _id: req.params.id, user: req.user._id });

  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada o no tienes permiso para modificarla');
  }

  // Validar que la cotización no esté pagada
  if (quote.status === 'paid') {
    res.status(400);
    throw new Error('No se puede modificar una cotización que ya ha sido pagada');
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
      quote.dueDate,
      'card',
      quote.taskType
    );

    quote.estimatedPrice = priceCalculation.precioTotal;
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
      quote.dueDate,
      'card',
      quote.taskType
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

// 💰 Calcular precio para cotización de venta
export const calculateSalesQuotePrice = asyncHandler(async (req, res) => {
  const { educationLevel, studyArea, pages, serviceType, taskType } = req.body;

  // Validar campos requeridos
  if (!educationLevel || !studyArea || !pages) {
    res.status(400);
    throw new Error('Faltan campos requeridos: nivel académico, área de estudio y páginas');
  }

  // Validar que páginas sea un número positivo
  const numPages = parseInt(pages);
  if (isNaN(numPages) || numPages <= 0) {
    res.status(400);
    throw new Error('El número de páginas debe ser un número positivo');
  }

  // Normalizar el área de estudio para la comparación
  const normalizedArea = studyArea.toLowerCase();

  // Determinar si es área de salud o matemáticas
  const isSaludOrMath =
    normalizedArea.includes('salud') ||
    normalizedArea.includes('matemáticas') ||
    normalizedArea.includes('área 2');

  // Determinar si es artículo científico
  const isArticuloCientifico = taskType && taskType.toLowerCase().includes('artículo');

  let pricePerPage = 0;

  // Si es Artículo Científico, usar precios especiales
  if (isArticuloCientifico) {
    // Precios especiales para artículos científicos (basado en $12,500 por 35 páginas = $357/página)
    switch (educationLevel.toLowerCase()) {
      case 'licenciatura':
        pricePerPage = isSaludOrMath ? 380 : 350;
        break;
      case 'maestría':
      case 'maestria':
        pricePerPage = isSaludOrMath ? 450 : 410;
        break;
      case 'maestría / especialidad salud':
      case 'maestria / especialidad salud':
      case 'especialidad':
        pricePerPage = 450;
        break;
      case 'doctorado':
        pricePerPage = isSaludOrMath ? 520 : 480;
        break;
      case 'doctorado / área de la salud':
        pricePerPage = 520;
        break;
      default:
        res.status(400);
        throw new Error('Nivel académico no válido');
    }
  } else {
    // Precios normales para Tesis, Tesina, y otros trabajos
    switch (educationLevel.toLowerCase()) {
      case 'licenciatura':
        pricePerPage = isSaludOrMath ? 250 : 220;
        break;
      case 'maestría':
      case 'maestria':
        pricePerPage = isSaludOrMath ? 300 : 270;
        break;
      case 'maestría / especialidad salud':
      case 'maestria / especialidad salud':
      case 'especialidad':
        pricePerPage = 300;
        break;
      case 'doctorado':
        pricePerPage = isSaludOrMath ? 350 : 320;
        break;
      case 'doctorado / área de la salud':
        pricePerPage = 350;
        break;
      default:
        res.status(400);
        throw new Error('Nivel académico no válido');
    }
  }

  // Si es servicio de corrección, aplicar 50% de descuento
  const isCorrectionService = serviceType === 'correccion' || serviceType === 'correction';
  if (isCorrectionService) {
    pricePerPage = pricePerPage * 0.5;
  }

  // Calcular precio total
  const totalPrice = pricePerPage * numPages;

  // Preparar respuesta con detalles
  res.json({
    success: true,
    pricing: {
      educationLevel,
      studyArea,
      pages: numPages,
      taskType: taskType || 'No especificado',
      serviceType: isCorrectionService ? 'Corrección' : 'Trabajo Completo',
      pricePerPage,
      totalPrice,
      formattedPrice: `$${totalPrice.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  });
});

