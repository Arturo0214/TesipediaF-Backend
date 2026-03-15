import Project from '../models/Project.js';
import Quote from '../models/Quote.js';
import Payment from '../models/Payment.js';
import asyncHandler from 'express-async-handler';
import { autoCreateClientUser } from '../utils/autoCreateClient.js';

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

    res.status(201).json(project);
});

// Get all projects (admin only)
export const getAllProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find()
        .sort({ kanbanOrder: 1 })
        .populate('quote')
        .populate('writer', 'name email')
        .populate('client', 'name email');
    res.json(projects);
});

// Get projects assigned to writer
export const getWriterProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ writer: req.user._id })
        .populate('quote')
        .populate('client', 'name email')
        .populate('payment');
    res.json(projects);
});

// Get client's projects
export const getClientProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ client: req.user._id })
        .populate('writer', 'name')
        .populate('quote')
        .populate('payment');
    res.json(projects);
});

// Get single project
export const getProjectById = asyncHandler(async (req, res) => {
    const project = await Project.findById(req.params.id)
        .populate('quote')
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
            if (lower.includes('50')) return '50-50';
            if (lower.includes('33')) return '33-33-34';
            if (lower.includes('quincena')) return '6-quincenas';
            if (lower.includes('msi') || lower.includes('meses sin intereses')) return '6-msi';
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