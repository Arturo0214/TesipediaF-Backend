import asyncHandler from 'express-async-handler';
import { v4 as uuidv4 } from 'uuid';
import Quote from '../models/Quote.js';
import Notification from '../models/Notification.js';
import createNotification from '../utils/createNotification.js';
import calculatePrice from '../utils/calculatePrice.js';
import cloudinary from '../config/cloudinary.js';
import crypto from 'crypto';
import GuestPayment from '../models/guestPayment.js';
import stripe from '../config/stripe.js';
import GeneratedQuote from '../models/GeneratedQuote.js';
import generateQuotePDF from '../utils/generateQuotePDF.js';
import syncHubSpotContact from '../utils/syncHubSpotContact.js';
import { notifyQuoteSent } from '../utils/sendWhatsAppNotification.js';
import Project from '../models/Project.js';
import Payment from '../models/Payment.js';
import { autoCreateClientUser } from '../utils/autoCreateClient.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// =============================================
// 🚀 Helper: Auto-crear proyecto + pago + usuario cuando cotización se marca como "paid"
// =============================================
const handleQuotePaid = async ({
  clientName, clientEmail, clientPhone, title, amount, method, esquemaPago,
  taskType, studyArea, career, educationLevel, pages, dueDate, requirements,
  quoteId, quoteType,
}) => {
  console.log(`[handleQuotePaid] Procesando cotización ${quoteType} ${quoteId} como pagada...`);

  // 1. Auto-crear usuario cliente si hay email
  let clientUser = null;
  let clientCreated = false;
  if (clientEmail) {
    const result = await autoCreateClientUser({
      clientName: clientName || 'Cliente',
      clientEmail,
      clientPhone,
      projectTitle: title,
    });
    clientUser = result.user;
    clientCreated = result.isNew;
  }

  // 2. Normalizar esquema de pago
  const normalizeEsquemaKey = (raw) => {
    if (!raw) return 'unico';
    const lower = raw.toLowerCase();
    if (lower.includes('50')) return '50-50';
    if (lower.includes('33')) return '33-33-34';
    if (lower.includes('quincena')) return '6-quincenas';
    if (lower.includes('msi') || lower.includes('meses sin intereses')) return '6-msi';
    return 'unico';
  };
  const esquemaKey = normalizeEsquemaKey(esquemaPago);

  // 3. Generar calendario de pagos
  const totalAmount = parseFloat(amount) || 0;
  const startDate = new Date();
  const generateSchedule = (total, esquema, start) => {
    const installments = [];
    switch (esquema) {
      case '50-50':
        installments.push(
          { number: 1, amount: Math.round(total * 0.5), dueDate: new Date(start), label: '1er pago (50%)', status: 'paid' },
          { number: 2, amount: Math.round(total * 0.5), dueDate: new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000), label: '2do pago (50%)', status: 'pending' }
        );
        break;
      case '33-33-34':
        installments.push(
          { number: 1, amount: Math.round(total * 0.33), dueDate: new Date(start), label: '1er pago (33%)', status: 'paid' },
          { number: 2, amount: Math.round(total * 0.33), dueDate: new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000), label: '2do pago (33%)', status: 'pending' },
          { number: 3, amount: Math.round(total * 0.34), dueDate: new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000), label: '3er pago (34%)', status: 'pending' }
        );
        break;
      case '6-quincenas':
        for (let i = 0; i < 6; i++) {
          installments.push({
            number: i + 1,
            amount: Math.round(total / 6),
            dueDate: new Date(start.getTime() + (i * 15) * 24 * 60 * 60 * 1000),
            label: `Quincena ${i + 1}`,
            status: i === 0 ? 'paid' : 'pending',
          });
        }
        const sumQ = installments.reduce((s, inst) => s + inst.amount, 0);
        if (sumQ !== total) installments[5].amount += (total - sumQ);
        break;
      case '6-msi':
        for (let i = 0; i < 6; i++) {
          installments.push({
            number: i + 1,
            amount: Math.round(total / 6),
            dueDate: new Date(start.getFullYear(), start.getMonth() + i, start.getDate()),
            label: `Mes ${i + 1} (MSI)`,
            status: i === 0 ? 'paid' : 'pending',
          });
        }
        const sumM = installments.reduce((s, inst) => s + inst.amount, 0);
        if (sumM !== total) installments[5].amount += (total - sumM);
        break;
      default: // unico
        installments.push(
          { number: 1, amount: total, dueDate: new Date(start), label: 'Pago único', status: 'paid' }
        );
    }
    return installments;
  };
  const schedule = generateSchedule(totalAmount, esquemaKey, startDate);

  // 4. Normalizar método de pago
  const normalizeMethod = (raw) => {
    if (!raw) return 'transferencia';
    const lower = raw.toLowerCase();
    if (lower.includes('tarjeta') || lower.includes('nu') || lower.includes('bbva')) return 'transferencia';
    if (lower.includes('efectivo')) return 'efectivo';
    if (lower.includes('stripe')) return 'stripe';
    if (lower.includes('paypal')) return 'paypal';
    return 'transferencia';
  };

  // 5. Crear el pago
  const payment = await Payment.create({
    amount: totalAmount,
    method: normalizeMethod(method),
    status: esquemaKey === 'unico' ? 'completed' : 'pendiente',
    transactionId: `AUTO-PAID-${Date.now()}`,
    currency: 'MXN',
    isManual: true,
    clientName: clientName || '',
    clientEmail: clientEmail || '',
    clientPhone: clientPhone || '',
    title: title || '',
    esquemaPago: esquemaKey,
    paymentDate: startDate,
    schedule,
    notes: `Auto-generado al marcar cotización ${quoteType} como pagada`,
  });

  // 6. Parsear fecha de entrega
  let parsedDueDate = null;
  if (dueDate) {
    if (dueDate instanceof Date) {
      parsedDueDate = dueDate;
    } else {
      const d = new Date(dueDate);
      if (!isNaN(d.getTime())) {
        parsedDueDate = d;
      } else {
        const meses = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
        const match = dueDate.match(/(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?/i);
        if (match) {
          const day = parseInt(match[1]);
          const month = meses[match[2].toLowerCase()];
          const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
          if (month !== undefined) parsedDueDate = new Date(year, month, day);
        }
      }
    }
  }

  // 7. Crear proyecto vinculado
  // FIX: Asegurar que TODOS los campos required tengan valores no vacíos
  // El modelo Project requiere: taskType, studyArea, career, educationLevel, taskTitle, requirements.text, pages, dueDate
  let linkedProject = null;
  let projectError = null;
  try {
    const quoteRef = quoteType === 'regular' ? quoteId : null;

    const projectData = {
      quote: quoteRef,
      taskType: taskType?.trim() || 'Trabajo Académico',
      studyArea: studyArea?.trim() || 'General',
      career: career?.trim() || 'General',
      educationLevel: educationLevel?.trim() || 'licenciatura',
      taskTitle: title?.trim() || 'Proyecto Tesipedia',
      requirements: { text: requirements?.trim() || 'Proyecto creado automáticamente al marcar cotización como pagada' },
      pages: parseInt(pages) || 1,
      dueDate: parsedDueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      priority: 'medium',
      status: 'pending',
      clientName: clientName || '',
      clientEmail: clientEmail || '',
      clientPhone: clientPhone || '',
      client: clientUser?._id || null,
      payment: payment._id,
    };

    console.log('[handleQuotePaid] Creando proyecto con datos:', JSON.stringify(projectData, null, 2));
    linkedProject = await Project.create(projectData);

    // Vincular proyecto al pago
    payment.project = linkedProject._id;
    await payment.save();

    console.log(`[handleQuotePaid] Proyecto creado: ${linkedProject._id}, Pago: ${payment._id}`);
  } catch (err) {
    if (err.errors) {
      const details = Object.entries(err.errors).map(([f, e]) => `${f}: ${e.message}`).join(', ');
      console.error('[handleQuotePaid] Error de validación creando proyecto:', details);
      projectError = details;
    } else {
      console.error('[handleQuotePaid] Error creando proyecto:', err.message);
      projectError = err.message;
    }
  }

  return { project: linkedProject, payment, clientCreated, clientUser, projectError };
};

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
    await createNotification(req.app, {
      user: SUPER_ADMIN_ID,
      type: 'cotizacion',
      message: `📝 Nueva cotización ${req.user ? 'creada por usuario registrado' : 'pública'} (${studyArea})`,
      data: {
        quoteId: newQuote._id,
        email,
      },
    });
  }

  // Sync contact to HubSpot (fire-and-forget, don't block response)
  syncHubSpotContact({
    email,
    name,
    phone,
    lifecycle: 'lead',
    source: 'endpoint',
  }).catch(err => console.error('[createQuote] HubSpot sync error:', err.message));

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
    user: quote.user, // Preservar el usuario
    status: quote.status // Para detectar cambio a paid
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

  // 🚀 Si cambió a "paid", auto-crear usuario + proyecto + pago
  let autoCreated = null;
  if (req.body.status === 'paid' && previousValues.status !== 'paid') {
    try {
      autoCreated = await handleQuotePaid({
        clientName: quote.name || '',
        clientEmail: quote.email || '',
        clientPhone: quote.phone || '',
        title: quote.taskTitle || quote.taskType || 'Proyecto Tesipedia',
        amount: quote.priceDetails?.finalPrice || quote.estimatedPrice || 0,
        method: 'transferencia',
        esquemaPago: 'unico',
        taskType: quote.taskType || 'Trabajo Académico',
        studyArea: quote.studyArea || 'General',
        career: quote.career || 'General',
        educationLevel: quote.educationLevel || 'licenciatura',
        pages: quote.pages || 1,
        dueDate: quote.dueDate || null,
        requirements: quote.requirements || '',
        quoteId: quote._id,
        quoteType: 'regular',
      });
      console.log('[UpdateQuote] Auto-creación completada:', {
        project: autoCreated.project?._id,
        payment: autoCreated.payment?._id,
        clientCreated: autoCreated.clientCreated,
      });
    } catch (err) {
      console.error('[UpdateQuote] Error en auto-creación:', err.message);
    }
  }

  res.json({
    ...updatedQuote.toObject(),
    _autoCreated: autoCreated || null,
  });
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

// �️ Mapeo de carreras comunes de México a áreas de estudio
const CAREER_TO_AREA_MAP = {
  'Área 1: Ciencias Físico Matemáticas e Ingenierías': [
    'ingeniería', 'ingeniera', 'sistemas', 'computación', 'computacion',
    'informática', 'informatica', 'matemáticas', 'matematicas', 'física',
    'fisica', 'arquitectura', 'civil', 'electrónica', 'electronica',
    'mecánica', 'mecanica', 'industrial', 'mecatrónica', 'mecatronica',
    'telecomunicaciones', 'robótica', 'robotica', 'software', 'datos',
    'aeronáutica', 'aeronautica', 'ambiental', 'geología', 'geologia',
    'topografía', 'topografia', 'eléctrica', 'electrica', 'automotriz'
  ],
  'Área 2: Ciencias Biológicas, Químicas y de la Salud': [
    'medicina', 'médico', 'medico', 'enfermería', 'enfermeria',
    'odontología', 'odontologia', 'dental', 'psicología', 'psicologia',
    'nutrición', 'nutricion', 'biología', 'biologia', 'química',
    'quimica', 'farmacia', 'farmacéutica', 'farmaceutica', 'veterinaria',
    'fisioterapia', 'rehabilitación', 'rehabilitacion', 'salud',
    'biomédica', 'biomedica', 'biotecnología', 'biotecnologia',
    'genómica', 'genomica', 'optometría', 'optometria', 'cirujano',
    'paramédico', 'paramedico', 'epidemiología', 'epidemiologia'
  ],
  'Área 3: Ciencias Sociales y Humanidades': [
    'derecho', 'abogado', 'leyes', 'administración', 'administracion',
    'contabilidad', 'contaduría', 'contaduria', 'contador', 'pedagogía',
    'pedagogia', 'educación', 'educacion', 'sociología', 'sociologia',
    'trabajo social', 'comunicación', 'comunicacion', 'periodismo',
    'historia', 'filosofía', 'filosofia', 'economía', 'economia',
    'turismo', 'mercadotecnia', 'marketing', 'finanzas', 'negocios',
    'comercio', 'relaciones internacionales', 'ciencias políticas',
    'ciencias politicas', 'politología', 'politologia', 'antropología',
    'antropologia', 'archivonomía', 'archivonomia', 'bibliotecología',
    'bibliotecologia', 'criminología', 'criminologia', 'criminalística',
    'criminalistica', 'geografía', 'geografia'
  ],
  'Área 4: Artes y Humanidades': [
    'diseño', 'diseno', 'arte', 'artes', 'música', 'musica',
    'literatura', 'letras', 'interiores', 'gráfico', 'grafico',
    'visual', 'escénicas', 'escenicas', 'cinematografía', 'cinematografia',
    'teatro', 'danza', 'cine', 'animación', 'animacion', 'multimedia',
    'moda', 'textil', 'fotografía', 'fotografia'
  ]
};

/**
 * Determina el área de estudio a partir del nombre de la carrera.
 * Realiza búsqueda parcial case-insensitive.
 * @param {string} career - Nombre de la carrera
 * @returns {string} Área de estudio correspondiente
 */
const detectStudyAreaFromCareer = (career) => {
  if (!career) return 'Área 3: Ciencias Sociales y Humanidades';

  const normalizedCareer = career.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const [area, keywords] of Object.entries(CAREER_TO_AREA_MAP)) {
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normalizedCareer.includes(normalizedKeyword)) {
        return area;
      }
    }
  }

  // Default si no hay match
  return 'Área 3: Ciencias Sociales y Humanidades';
};

// �💰 Calcular precio para cotización de venta
export const calculateSalesQuotePrice = asyncHandler(async (req, res) => {
  const { educationLevel, pages, serviceType, taskType, career } = req.body;
  let { studyArea } = req.body;

  // Validar campos requeridos mínimos
  if (!educationLevel || !pages) {
    res.status(400);
    throw new Error('Faltan campos requeridos: nivel académico y páginas');
  }

  // Si no viene studyArea, intentar detectarla desde career
  let studyAreaAutoDetected = false;
  if (!studyArea) {
    if (career) {
      studyArea = detectStudyAreaFromCareer(career);
      studyAreaAutoDetected = true;
      console.log(`🗺️ studyArea auto-detectada desde career "${career}" → "${studyArea}"`);
    } else {
      res.status(400);
      throw new Error('Debe proporcionar studyArea o career para calcular el precio');
    }
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
    // Precios especiales para artículos científicos
    // Basados en: $12,500 final (con desc. 10%) ÷ 35 págs = $400/pág base
    switch (educationLevel.toLowerCase()) {
      case 'licenciatura':
        pricePerPage = isSaludOrMath ? 435 : 400;
        break;
      case 'maestría':
      case 'maestria':
        pricePerPage = isSaludOrMath ? 510 : 470;
        break;
      case 'maestría / especialidad salud':
      case 'maestria / especialidad salud':
      case 'especialidad':
        pricePerPage = isSaludOrMath ? 510 : 470; // Mismo precio que maestría
        break;
      case 'doctorado':
        pricePerPage = isSaludOrMath ? 590 : 540;
        break;
      case 'doctorado / área de la salud':
        pricePerPage = 590;
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
        pricePerPage = isSaludOrMath ? 300 : 270; // Mismo precio que maestría
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

  // Aplicar modificador según el tipo de servicio
  // Modalidad 1: 100% (hacemos todo) - sin modificador
  // Modalidad 2: 75% (acompañamiento) - aplicar 0.75
  // Corrección: 50% (solo corrección) - aplicar 0.5
  const isModalidad2 = serviceType === 'modalidad2';
  const isCorreccion = serviceType === 'correccion' || serviceType === 'correction';

  if (isModalidad2) {
    pricePerPage = pricePerPage * 0.75;
  } else if (isCorreccion) {
    pricePerPage = pricePerPage * 0.5;
  }
  // Si es modalidad1 o cualquier otro valor, se mantiene el 100%

  // Calcular precio total
  const totalPrice = pricePerPage * numPages;

  // Determinar descripción del tipo de servicio
  let serviceTypeDescription = 'Modalidad 1 - Hacemos todo';
  if (isModalidad2) {
    serviceTypeDescription = 'Modalidad 2 - Acompañamiento';
  } else if (isCorreccion) {
    serviceTypeDescription = 'Solo Corrección';
  }

  // Preparar respuesta con detalles
  res.json({
    success: true,
    pricing: {
      educationLevel,
      studyArea,
      studyAreaAutoDetected,
      career: career || null,
      pages: numPages,
      taskType: taskType || 'No especificado',
      serviceType: serviceTypeDescription,
      pricePerPage,
      totalPrice,
      formattedPrice: `$${totalPrice.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  });
});


// 💾 Guardar cotización generada (SalesQuote)
export const saveGeneratedQuote = asyncHandler(async (req, res) => {
  console.log('--------------------------------------------------');
  console.log('📌 BACKEND: Received request to save generated quote');
  console.log('User:', req.user ? req.user._id : 'Guest');
  console.log('Body:', JSON.stringify(req.body, null, 2));

  try {
    // Normalize and clean data
    const quoteData = {
      ...req.body,
      generatedBy: req.user ? req.user._id : null,
    };

    console.log('Calculated quoteData to save:', quoteData);

    // Create new GeneratedQuote
    const newQuote = await GeneratedQuote.create(quoteData);

    console.log('✅ Cotización generada guardada con ID:', newQuote._id);

    // Sync contact to HubSpot if we have an email
    if (quoteData.clientEmail) {
      syncHubSpotContact({
        email: quoteData.clientEmail,
        name: quoteData.clientName,
        phone: quoteData.clientPhone,
        lifecycle: 'lead',
        source: 'cotizador',
      }).catch(err => console.error('[saveGeneratedQuote] HubSpot sync error:', err.message));
    }

    // 📲 Notificar al equipo por WhatsApp (fire-and-forget)
    notifyQuoteSent(quoteData).catch(err =>
      console.error('[saveGeneratedQuote] WhatsApp notification error:', err.message)
    );

    res.status(201).json({
      success: true,
      message: 'Cotización guardada exitosamente',
      quote: newQuote
    });
  } catch (error) {
    console.error('❌ Error saving generated quote:', error);
    res.status(500);
    throw new Error('Error al guardar la cotización: ' + error.message);
  }
});

// 📋 Obtener todas las cotizaciones generadas (admin)
export const getGeneratedQuotes = asyncHandler(async (req, res) => {
  const quotes = await GeneratedQuote.find({}).sort({ createdAt: -1 }).populate('generatedBy', 'name email');
  res.json(quotes);
});

// 🔄 Actualizar cotización generada (admin)
export const updateGeneratedQuote = asyncHandler(async (req, res) => {
  const quote = await GeneratedQuote.findById(req.params.id);
  if (!quote) {
    res.status(404);
    throw new Error('Cotización no encontrada');
  }

  const previousStatus = quote.status;
  const newStatus = req.body.status;

  // Update status if provided
  if (newStatus) {
    quote.status = newStatus;
  }

  const updatedQuote = await quote.save();

  // 🚀 Si cambió a "paid", auto-crear usuario + proyecto + pago
  let autoCreated = null;
  if (newStatus === 'paid' && previousStatus !== 'paid') {
    try {
      autoCreated = await handleQuotePaid({
        clientName: quote.clientName || '',
        clientEmail: quote.clientEmail || '',
        clientPhone: quote.clientPhone || '',
        title: quote.tituloTrabajo || quote.tipoTrabajo || 'Proyecto Tesipedia',
        amount: quote.precioConDescuento || quote.precioBase || 0,
        method: quote.metodoPago || 'transferencia',
        esquemaPago: quote.esquemaPago || 'unico',
        taskType: quote.tipoTrabajo || 'Trabajo Académico',
        studyArea: quote.area || 'General',
        career: quote.carrera || 'General',
        educationLevel: 'licenciatura',
        pages: parseInt(quote.extensionEstimada) || 1,
        dueDate: quote.fechaEntrega || null,
        requirements: quote.descripcionServicio || '',
        quoteId: quote._id,
        quoteType: 'generated',
      });
      console.log('[UpdateGeneratedQuote] Auto-creación completada:', {
        project: autoCreated.project?._id,
        payment: autoCreated.payment?._id,
        clientCreated: autoCreated.clientCreated,
      });
    } catch (err) {
      console.error('[UpdateGeneratedQuote] Error en auto-creación:', err.message);
    }
  }

  res.json({
    ...updatedQuote.toObject(),
    _autoCreated: autoCreated || null,
  });
});

// ❌ Eliminar cotización generada (admin)
export const deleteGeneratedQuote = asyncHandler(async (req, res) => {
  const quote = await GeneratedQuote.findById(req.params.id);
  if (!quote) {
    res.status(404);
    throw new Error('Cotización generada no encontrada');
  }

  await quote.deleteOne();
  res.json({ message: 'Cotización generada eliminada correctamente', id: req.params.id });
});

// 📤 Subir PDF de cotización a Cloudinary y obtener URL pública
export const uploadQuotePDF = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No se recibió ningún archivo PDF');
  }

  const { quoteId } = req.body; // ID del GeneratedQuote (opcional pero recomendado)

  try {
    // Subir PDF a Cloudinary usando upload_stream (multer usa memoryStorage, no haypath)
    const pdfPublicId = `generated-quotes/cotizacion_${quoteId || Date.now()}`;

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',  // PDF se clasifica como 'raw' en Cloudinary
          folder: 'generated-quotes',
          public_id: `cotizacion_${quoteId || Date.now()}`,
          overwrite: true,
          format: 'pdf',
          type: 'upload',
          access_mode: 'public',
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    const pdfPublicIdResult = uploadResult.public_id;

    // Generar URL de descarga privada (bypass de restricciones PDF en Cloudinary)
    const pdfUrl = cloudinary.utils.private_download_url(
      pdfPublicIdResult,
      'pdf',
      {
        resource_type: 'raw',
        type: 'upload',
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 días
      }
    );

    // Si se proporcionó un quoteId, actualizar el documento en BD
    if (quoteId) {
      await GeneratedQuote.findByIdAndUpdate(
        quoteId,
        { pdfUrl, pdfPublicId: pdfPublicIdResult },
        { new: true }
      );
    }

    res.status(200).json({
      success: true,
      pdfUrl,
      pdfPublicId: pdfPublicIdResult,
      message: 'PDF subido exitosamente a Cloudinary',
    });
  } catch (error) {
    console.error('❌ Error subiendo PDF a Cloudinary:', error);
    res.status(500);
    throw new Error('Error al subir el PDF: ' + error.message);
  }
});

// 📄 Generar PDF de cotización server-side y subir a Cloudinary (para n8n/WhatsApp)
export const generateAndUploadQuotePDF = async (req, res) => {
  try {
    const data = req.body;

    if (!data || (!data.tipoServicio && !data.serviceType)) {
      return res.status(400).json({
        success: false,
        message: 'Se requieren datos de la cotización (al menos tipoServicio)',
      });
    }

    // 1. Generar el PDF en memoria
    const pdfBuffer = await generateQuotePDF(data);

    // 2. Subir a Cloudinary como raw upload
    const uploadResult = await new Promise((resolve, reject) => {
      const timestamp = Date.now();

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'tesipedia/cotizaciones',
          public_id: `cotizacion-${data.nombre ? data.nombre.replace(/\s+/g, '-').toLowerCase() : 'cliente'}-${timestamp}`,
          format: 'pdf',
          access_mode: 'public',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      uploadStream.end(pdfBuffer);
    });

    // 3. Generar URL de descarga privada (bypass de restricciones PDF en Cloudinary)
    const downloadUrl = cloudinary.utils.private_download_url(
      uploadResult.public_id,
      'pdf',
      {
        resource_type: 'raw',
        type: 'upload',
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 días
      }
    );

    // 4. Devolver la URL de descarga
    return res.status(200).json({
      success: true,
      pdfUrl: downloadUrl,
      fallbackUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
    });
  } catch (error) {
    console.error('Error generando PDF de cotización:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al generar el PDF',
      error: error.message,
    });
  }
};
