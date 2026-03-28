import Project from '../models/Project.js';
import Quote from '../models/Quote.js';
import Payment from '../models/Payment.js';
import asyncHandler from 'express-async-handler';
import { autoCreateClientUser } from '../utils/autoCreateClient.js';
import createNotification from '../utils/createNotification.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

// Create a new project from a quote
export const createProjectFromQuote = asyncHandler(async (req, res) => {
    const { quoteId } = req.body;

    const quote = await Quote.findById(quoteId);
    if (!quote) {
        res.status(404);
        throw new Error('Quote not found');
    }

    if (quote.status !== 'paid') {
        res.status(400);
        throw new Error('Quote must be paid before creating a project');
    }

    const existingProject = await Project.findOne({ quote: quoteId });
    if (existingProject) {
        res.status(400);
        throw new Error('Project already exists for this quote');
    }

    const project = await Project.create({
        quote: quote._id,
        client: quote.user,
        taskType: quote.taskType,
        studyArea: quote.studyArea,
        career: quote.career,
        educationLevel: quote.educationLevel,
        taskTitle: quote.taskTitle,
        requirements: quote.requirements,
        pages: quote.pages,
        dueDate: quote.dueDate,
    });

    quote.convertedToOrder = true;
    await quote.save();

    if (SUPER_ADMIN_ID) {
        await createNotification(req.app, {
            user: SUPER_ADMIN_ID,
            type: 'proyecto',
            message: `🚀 Nuevo proyecto creado: ${quote.taskTitle || quote.taskType}`,
            data: { projectId: project._id, quoteId: quote._id },
            link: '/admin/proyectos',
            priority: 'high',
        });
    }

    res.status(201).json(project);
});

// Get all projects (admin only)
export const getAllProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find()
        .sort({ kanbanOrder: 1 })
        .populate('quote')
        .populate('generatedQuote')
        .populate('writer', 'name email')
        .populate('client', 'name email');
    res.json(projects);
});

// Get projects assigned to writer
export const getWriterProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ writer: req.user._id })
        .populate('quote')
        .populate('generatedQuote')
        .populate('client', 'name email')
        .populate('payment');
    res.json(projects);
});

// Get client's projects
export const getClientProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ client: req.user._id })
        .populate('writer', 'name')
        .populate('quote')
        .populate('generatedQuote')
        .populate('payment');
    res.json(projects);
});

// Get single project
export const getProjectById = asyncHandler(async (req, res) => {
    const project = await Project.findById(req.params.id)
        .populate('quote')
        .populate('generatedQuote')
        .populate('writer', 'name email')
        .populate('client', 'name email');

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    // Check if user has access to this project
    if (!req.user.isAdmin &&
        project.writer?.toString() !== req.user._id.toString() &&
        project.client?.toString() !== req.user._id.toString()) {
        res.status(403);
        throw new Error('Not authorized to access this project');
    }

    res.json(project);
});

// Assign writer to project (admin only)
export const assignWriter = asyncHandler(async (req, res) => {
    const { writerId } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    project.writer = writerId;
    project.status = 'in_progress';
    await project.save();

    if (SUPER_ADMIN_ID) {
        await createNotification(req.app, {
            user: SUPER_ADMIN_ID,
            type: 'proyecto',
            message: `✍️ Redactor asignado al proyecto: ${project.taskTitle || project.taskType || 'Sin título'}`,
            data: { projectId: project._id, writerId },
            link: '/admin/proyectos',
        });
    }

    res.json(project);
});

// Update project status
export const updateProjectStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    // Verify user has permission to update status
    if (!req.user.isAdmin && project.writer?.toString() !== req.user._id.toString()) {
        res.status(403);
        throw new Error('Not authorized to update this project');
    }

    project.status = status;
    await project.save();

    const statusLabels = {
        pending: 'Pendiente', in_progress: 'En progreso', review: 'En revisión',
        revision: 'En corrección', completed: 'Completado', cancelled: 'Cancelado',
    };
    if (SUPER_ADMIN_ID) {
        const priority = ['completed', 'cancelled'].includes(status) ? 'high' : 'medium';
        await createNotification(req.app, {
            user: SUPER_ADMIN_ID,
            type: 'proyecto',
            message: `📋 Proyecto "${project.taskTitle || 'Sin título'}" → ${statusLabels[status] || status}`,
            data: { projectId: project._id, status },
            link: '/admin/proyectos',
            priority,
        });
    }

    res.json(project);
});

// Update project progress
export const updateProgress = asyncHandler(async (req, res) => {
    const { progress } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    // Verify writer is updating their own project
    if (project.writer?.toString() !== req.user._id.toString()) {
        res.status(403);
        throw new Error('Not authorized to update this project');
    }

    project.progress = progress;
    await project.save();

    // Notificar hitos importantes de progreso (25%, 50%, 75%, 100%)
    if (SUPER_ADMIN_ID && [25, 50, 75, 100].includes(progress)) {
        await createNotification(req.app, {
            user: SUPER_ADMIN_ID,
            type: 'proyecto',
            message: `📊 Proyecto "${project.taskTitle || 'Sin título'}" alcanzó ${progress}% de avance`,
            data: { projectId: project._id, progress },
            link: '/admin/proyectos',
            priority: progress === 100 ? 'high' : 'medium',
        });
    }

    res.json(project);
});

// Add comment to project
export const addComment = asyncHandler(async (req, res) => {
    const { text } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    // Verify user has access to this project
    if (!req.user.isAdmin &&
        project.writer?.toString() !== req.user._id.toString() &&
        project.client?.toString() !== req.user._id.toString()) {
        res.status(403);
        throw new Error('Not authorized to comment on this project');
    }

    project.comments.push({
        user: req.user._id,
        text
    });

    await project.save();
    res.json(project);
});

// Create a project manually (admin only, no quote required)
// También crea un pago vinculado y un usuario cliente automáticamente
export const createManualProject = asyncHandler(async (req, res) => {
    const {
        taskTitle, taskType, studyArea, career, educationLevel,
        clientName, clientEmail, clientPhone, requirements, pages, dueDate,
        priority, status,
        // Campos de pago (opcionales — si vienen, se crea el pago vinculado)
        amount, method, esquemaPago, paymentDate, paymentNotes,
    } = req.body;

    if (!taskTitle || !taskType || !dueDate) {
        res.status(400);
        throw new Error('Se requiere título, tipo de trabajo y fecha de entrega');
    }

    // 1. Auto-crear usuario cliente si hay email
    let clientUser = null;
    if (clientEmail) {
        const { user } = await autoCreateClientUser({
            clientName: clientName || 'Cliente',
            clientEmail,
            clientPhone,
            projectTitle: taskTitle,
        });
        clientUser = user;
    }

    // 2. Crear el proyecto
    const project = await Project.create({
        quote: null,
        taskType,
        studyArea: studyArea || 'General',
        career: career || 'General',
        educationLevel: educationLevel || 'licenciatura',
        taskTitle,
        requirements: { text: requirements || 'Proyecto creado manualmente' },
        pages: pages || 1,
        dueDate: new Date(dueDate),
        priority: priority || 'medium',
        status: status || 'pending',
        clientName: clientName || '',
        clientEmail: clientEmail || '',
        clientPhone: clientPhone || '',
        client: clientUser?._id || null,
    });

    // 3. Si se proporcionó monto, crear pago vinculado automáticamente
    let linkedPayment = null;
    if (amount && parseFloat(amount) > 0) {
        const totalAmount = parseFloat(amount);
        const startDate = paymentDate ? new Date(paymentDate) : new Date();

        // Normalizar esquema
        const normalizeEsquemaKey = (raw) => {
            if (!raw) return 'unico';
            const lower = raw.toLowerCase();
            if (lower.includes('quincena')) return '6-quincenas';
            if (lower.includes('msi') || lower.includes('meses sin intereses')) return '6-msi';
            if (lower.includes('33%') || lower.includes('33-33') || lower.includes('33')) return '33-33-34';
            if (lower.includes('50%') || lower.includes('50-50') || lower.includes('50')) return '50-50';
            return 'unico';
        };

        const esquemaKey = normalizeEsquemaKey(esquemaPago);

        // Generar schedule
        const generateSchedule = (total, esquema, start) => {
            const installments = [];
            switch (esquema) {
                case '50-50':
                    installments.push(
                        { number: 1, amount: Math.round(total * 0.5), dueDate: new Date(start), label: '1er pago (50%)', status: 'pending' },
                        { number: 2, amount: Math.round(total * 0.5), dueDate: new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000), label: '2do pago (50%)', status: 'pending' }
                    );
                    break;
                case '33-33-34':
                    installments.push(
                        { number: 1, amount: Math.round(total * 0.33), dueDate: new Date(start), label: '1er pago (33%)', status: 'pending' },
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
                            status: 'pending',
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
                            status: 'pending',
                        });
                    }
                    const sumM = installments.reduce((s, inst) => s + inst.amount, 0);
                    if (sumM !== total) installments[5].amount += (total - sumM);
                    break;
                default:
                    installments.push(
                        { number: 1, amount: total, dueDate: new Date(start), label: 'Pago único', status: 'paid' }
                    );
            }
            return installments;
        };

        const schedule = generateSchedule(totalAmount, esquemaKey, startDate);

        linkedPayment = await Payment.create({
            amount: totalAmount,
            method: method || 'transferencia',
            status: 'completed',
            transactionId: `MANUAL-${Date.now()}`,
            currency: 'MXN',
            isManual: true,
            clientName: clientName || '',
            clientEmail: clientEmail || '',
            clientPhone: clientPhone || '',
            title: taskTitle,
            esquemaPago: esquemaKey,
            paymentDate: startDate,
            schedule,
            notes: paymentNotes || '',
            project: project._id,
        });

        // Vincular pago al proyecto
        project.payment = linkedPayment._id;
        await project.save();
    }

    if (SUPER_ADMIN_ID) {
        await createNotification(req.app, {
            user: SUPER_ADMIN_ID,
            type: 'proyecto',
            message: `🆕 Proyecto manual creado: ${taskTitle}${clientName ? ` (${clientName})` : ''}`,
            data: { projectId: project._id },
            link: '/admin/proyectos',
            priority: 'high',
        });
    }

    res.status(201).json({
        project,
        payment: linkedPayment,
        clientCreated: clientUser ? true : false,
    });
});

// Create client user from project data (admin only)
export const createClientFromProject = asyncHandler(async (req, res) => {
    const project = await Project.findById(req.params.id)
        .populate('client', 'name email');

    if (!project) {
        res.status(404);
        throw new Error('Proyecto no encontrado');
    }

    // Si ya tiene un cliente vinculado, retornar info
    if (project.client) {
        return res.json({
            alreadyExists: true,
            user: project.client,
            message: `El cliente ya tiene cuenta: ${project.client.email}`,
        });
    }

    if (!project.clientEmail && !project.clientPhone) {
        res.status(400);
        throw new Error('El proyecto no tiene email ni teléfono de cliente para crear la cuenta');
    }

    const { user, isNew, password, loginIdentifier } = await autoCreateClientUser({
        clientName: project.clientName || 'Cliente',
        clientEmail: project.clientEmail || '',
        clientPhone: project.clientPhone || '',
        projectTitle: project.taskTitle,
    });

    if (!user) {
        res.status(500);
        throw new Error('No se pudo crear el usuario cliente');
    }

    // Vincular el usuario al proyecto
    project.client = user._id;
    await project.save();

    // Re-popular para devolver datos completos
    await project.populate('client', 'name email phone');

    res.json({
        alreadyExists: !isNew,
        user: { _id: user._id, name: user.name, email: user.email, phone: user.phone },
        password: isNew ? password : null,
        loginIdentifier: loginIdentifier || user.email,
        message: isNew
            ? `Usuario creado — Login: ${loginIdentifier || user.email} — Credenciales enviadas por WhatsApp`
            : `El usuario ya existía: ${user.email} — Se vinculó al proyecto`,
    });
});

// 🔧 Migration: Fix quote_1 index and create missing projects for paid quotes
export const migrateFixQuoteIndex = asyncHandler(async (req, res) => {
    const mongoose = (await import('mongoose')).default;
    const GeneratedQuote = (await import('../models/GeneratedQuote.js')).default;
    const { autoCreateClientUser } = await import('../utils/autoCreateClient.js');

    const results = { indexDropped: false, projectsCreated: 0, skipped: 0, errors: [] };

    // Step 1: Drop the problematic quote_1 unique index
    try {
        const collection = mongoose.connection.db.collection('projects');
        const indexes = await collection.indexes();
        const quoteIndex = indexes.find(idx => idx.name === 'quote_1');
        if (quoteIndex) {
            await collection.dropIndex('quote_1');
            results.indexDropped = true;
            console.log('[Migration] Dropped quote_1 index');
        } else {
            console.log('[Migration] quote_1 index not found (already removed)');
        }
    } catch (indexErr) {
        console.error('[Migration] Error dropping index:', indexErr.message);
        results.errors.push(`Index: ${indexErr.message}`);
    }

    // Step 2: Create missing projects for paid GeneratedQuotes
    const paidGenerated = await GeneratedQuote.find({ status: 'paid' });

    for (const quote of paidGenerated) {
        // Check if project already exists for this generated quote
        const existing = await Project.findOne({
            $or: [
                { generatedQuote: quote._id },
                { clientName: quote.clientName, taskTitle: quote.tituloTrabajo || quote.tipoTrabajo || 'Proyecto Tesipedia' }
            ]
        });

        if (existing) {
            // Link generatedQuote if not already linked
            if (!existing.generatedQuote) {
                existing.generatedQuote = quote._id;
                await existing.save();
            }
            results.skipped++;
            continue;
        }

        try {
            // Parse due date from Spanish format
            let parsedDueDate = null;
            if (quote.fechaEntrega) {
                const meses = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
                const match = quote.fechaEntrega.match(/(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?/i);
                if (match) {
                    const day = parseInt(match[1]);
                    const month = meses[match[2].toLowerCase()];
                    const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
                    if (month !== undefined) parsedDueDate = new Date(year, month, day);
                }
                if (!parsedDueDate) {
                    const d = new Date(quote.fechaEntrega);
                    if (!isNaN(d.getTime())) parsedDueDate = d;
                }
            }

            // Auto-create client user if email or phone
            let clientUser = null;
            if (quote.clientEmail || quote.clientPhone) {
                const result = await autoCreateClientUser({
                    clientName: quote.clientName || 'Cliente',
                    clientEmail: quote.clientEmail || '',
                    clientPhone: quote.clientPhone || '',
                    projectTitle: quote.tituloTrabajo || quote.tipoTrabajo,
                });
                clientUser = result.user;
            }

            // Find existing payment for this quote
            const existingPayment = await Payment.findOne({
                clientName: quote.clientName,
                title: quote.tituloTrabajo || quote.tipoTrabajo,
                isManual: true,
            });

            const project = await Project.create({
                quote: null,
                generatedQuote: quote._id,
                taskType: quote.tipoTrabajo?.trim() || 'Trabajo Académico',
                studyArea: quote.area?.trim() || 'General',
                career: quote.carrera?.trim() || 'General',
                educationLevel: 'licenciatura',
                taskTitle: (quote.tituloTrabajo?.trim() || quote.tipoTrabajo?.trim() || 'Proyecto Tesipedia'),
                requirements: { text: quote.descripcionServicio?.trim() || 'Proyecto creado por migración' },
                pages: parseInt(quote.extensionEstimada) || 1,
                dueDate: parsedDueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                priority: 'medium',
                status: 'pending',
                clientName: quote.clientName || '',
                clientEmail: quote.clientEmail || '',
                clientPhone: quote.clientPhone || '',
                client: clientUser?._id || null,
                payment: existingPayment?._id || null,
            });

            // Link payment to project
            if (existingPayment && !existingPayment.project) {
                existingPayment.project = project._id;
                await existingPayment.save();
            }

            results.projectsCreated++;
            console.log(`[Migration] Created project for: ${quote.clientName} - ${project.taskTitle}`);
        } catch (err) {
            console.error(`[Migration] Error for ${quote.clientName}:`, err.message);
            results.errors.push(`${quote.clientName}: ${err.message}`);
        }
    }

    // Step 3: Also check paid regular quotes
    const paidRegular = await Quote.find({ status: 'paid' });
    for (const quote of paidRegular) {
        const existing = await Project.findOne({ quote: quote._id });
        if (existing) { results.skipped++; continue; }

        try {
            let clientUser = null;
            if (quote.email || quote.phone) {
                const result = await autoCreateClientUser({
                    clientName: quote.name || 'Cliente',
                    clientEmail: quote.email || '',
                    clientPhone: quote.phone || '',
                    projectTitle: quote.taskTitle,
                });
                clientUser = result.user;
            }

            await Project.create({
                quote: quote._id,
                generatedQuote: null,
                taskType: quote.taskType,
                studyArea: quote.studyArea,
                career: quote.career,
                educationLevel: quote.educationLevel,
                taskTitle: quote.taskTitle,
                requirements: quote.requirements || { text: 'Proyecto creado por migración' },
                pages: quote.pages,
                dueDate: quote.dueDate,
                priority: 'medium',
                status: 'pending',
                client: clientUser?._id || quote.user || null,
                clientName: quote.name || '',
                clientEmail: quote.email || '',
                clientPhone: quote.phone || '',
            });
            results.projectsCreated++;
        } catch (err) {
            results.errors.push(`Regular ${quote.name}: ${err.message}`);
        }
    }

    res.json({
        message: 'Migración completada',
        ...results,
    });
});

// Update project (general updates for status, priority, color, kanbanOrder, dueDate)
export const updateProject = asyncHandler(async (req, res) => {
    const { status, priority, color, kanbanOrder, dueDate } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    // Verify admin has permission
    if (!req.user.isAdmin) {
        res.status(403);
        throw new Error('Not authorized to update this project');
    }

    // Update allowed fields
    if (status !== undefined) project.status = status;
    if (priority !== undefined) project.priority = priority;
    if (color !== undefined) project.color = color;
    if (kanbanOrder !== undefined) project.kanbanOrder = kanbanOrder;
    if (dueDate !== undefined) project.dueDate = dueDate;

    await project.save();
    res.json(project);
}); 