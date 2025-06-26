import Project from '../models/Project.js';
import Quote from '../models/Quote.js';
import asyncHandler from '../middleware/asyncErrors.js';

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
        .populate('quote')
        .populate('writer', 'name email')
        .populate('client', 'name email');
    res.json(projects);
});

// Get projects assigned to writer
export const getWriterProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ writer: req.user._id })
        .populate('quote')
        .populate('client', 'name email');
    res.json(projects);
});

// Get client's projects
export const getClientProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ client: req.user._id })
        .populate('writer', 'name')
        .populate('quote');
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