import asyncHandler from 'express-async-handler';
import {
    getAuthUrl,
    setTokens,
    getTokens,
    isAuthenticated,
    getCalendarClient,
    oauth2Client
} from '../config/googleCalendar.js';
import Project from '../models/Project.js';

// Get the Google OAuth URL
export const getAuthUrlEndpoint = asyncHandler(async (req, res) => {
    const authUrl = getAuthUrl();
    res.json({ authUrl });
});

// Handle OAuth callback
export const handleCallback = asyncHandler(async (req, res) => {
    const { code } = req.query;

    if (!code) {
        res.status(400);
        throw new Error('Authorization code not provided');
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        setTokens(tokens);

        // Redirect to frontend with success message
        // In production, you might want to store tokens in DB or session
        res.redirect(`${process.env.CLIENT_URL}/admin/proyectos?google=connected`);
    } catch (error) {
        res.status(400);
        throw new Error(`Failed to exchange authorization code: ${error.message}`);
    }
});

// Get connection status
export const getConnectionStatus = asyncHandler(async (req, res) => {
    const connected = isAuthenticated();
    res.json({ connected });
});

// Get calendar events
export const getCalendarEvents = asyncHandler(async (req, res) => {
    if (!isAuthenticated()) {
        res.status(401);
        throw new Error('Google Calendar is not authenticated');
    }

    const { timeMin, timeMax } = req.query;

    try {
        const calendar = getCalendarClient();
        const events = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin || new Date().toISOString(),
            timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            showDeleted: false,
            singleEvents: true,
            orderBy: 'startTime',
        });

        res.json(events.data);
    } catch (error) {
        res.status(500);
        throw new Error(`Failed to fetch calendar events: ${error.message}`);
    }
});

// Create a calendar event from a project
export const createCalendarEvent = asyncHandler(async (req, res) => {
    if (!isAuthenticated()) {
        res.status(401);
        throw new Error('Google Calendar is not authenticated');
    }

    const { projectId } = req.body;

    const project = await Project.findById(projectId)
        .populate('client', 'name email');

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    try {
        const calendar = getCalendarClient();

        // Map priority to Google Calendar color IDs
        const colorMap = {
            'low': '3',      // Blue
            'medium': '5',   // Yellow
            'high': '6',     // Red
            'urgent': '11'   // Tomato
        };

        const event = {
            summary: project.taskTitle,
            description: `Task Type: ${project.taskType}\nCareer: ${project.career}\nStudy Area: ${project.studyArea}\nProgress: ${project.progress}%\nClient: ${project.client?.name || 'N/A'}`,
            start: {
                date: project.dueDate.toISOString().split('T')[0],
                timeZone: 'America/New_York'
            },
            end: {
                date: project.dueDate.toISOString().split('T')[0],
                timeZone: 'America/New_York'
            },
            colorId: colorMap[project.priority] || '5'
        };

        const createdEvent = await calendar.events.insert({
            calendarId: 'primary',
            resource: event
        });

        // Save the event ID on the project
        project.googleCalendarEventId = createdEvent.data.id;
        await project.save();

        res.status(201).json(createdEvent.data);
    } catch (error) {
        res.status(500);
        throw new Error(`Failed to create calendar event: ${error.message}`);
    }
});

// Update a calendar event
export const updateCalendarEvent = asyncHandler(async (req, res) => {
    if (!isAuthenticated()) {
        res.status(401);
        throw new Error('Google Calendar is not authenticated');
    }

    const { eventId } = req.params;
    const { projectId } = req.body;

    const project = await Project.findById(projectId)
        .populate('client', 'name email');

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    try {
        const calendar = getCalendarClient();

        const colorMap = {
            'low': '3',
            'medium': '5',
            'high': '6',
            'urgent': '11'
        };

        const event = {
            summary: project.taskTitle,
            description: `Task Type: ${project.taskType}\nCareer: ${project.career}\nStudy Area: ${project.studyArea}\nProgress: ${project.progress}%\nClient: ${project.client?.name || 'N/A'}`,
            start: {
                date: project.dueDate.toISOString().split('T')[0],
                timeZone: 'America/New_York'
            },
            end: {
                date: project.dueDate.toISOString().split('T')[0],
                timeZone: 'America/New_York'
            },
            colorId: colorMap[project.priority] || '5'
        };

        const updatedEvent = await calendar.events.update({
            calendarId: 'primary',
            eventId: eventId,
            resource: event
        });

        res.json(updatedEvent.data);
    } catch (error) {
        res.status(500);
        throw new Error(`Failed to update calendar event: ${error.message}`);
    }
});

// Delete a calendar event
export const deleteCalendarEvent = asyncHandler(async (req, res) => {
    if (!isAuthenticated()) {
        res.status(401);
        throw new Error('Google Calendar is not authenticated');
    }

    const { eventId } = req.params;

    try {
        const calendar = getCalendarClient();
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId
        });

        // Remove the event ID from any projects that reference it
        await Project.findOneAndUpdate(
            { googleCalendarEventId: eventId },
            { googleCalendarEventId: null }
        );

        res.json({ message: 'Event deleted successfully' });
    } catch (error) {
        res.status(500);
        throw new Error(`Failed to delete calendar event: ${error.message}`);
    }
});

// Sync a project to calendar (create or update)
export const syncProjectToCalendar = asyncHandler(async (req, res) => {
    if (!isAuthenticated()) {
        res.status(401);
        throw new Error('Google Calendar is not authenticated');
    }

    const { projectId } = req.params;

    const project = await Project.findById(projectId)
        .populate('client', 'name email');

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    try {
        const calendar = getCalendarClient();

        const colorMap = {
            'low': '3',
            'medium': '5',
            'high': '6',
            'urgent': '11'
        };

        const eventData = {
            summary: project.taskTitle,
            description: `Task Type: ${project.taskType}\nCareer: ${project.career}\nStudy Area: ${project.studyArea}\nProgress: ${project.progress}%\nClient: ${project.client?.name || 'N/A'}`,
            start: {
                date: project.dueDate.toISOString().split('T')[0],
                timeZone: 'America/New_York'
            },
            end: {
                date: project.dueDate.toISOString().split('T')[0],
                timeZone: 'America/New_York'
            },
            colorId: colorMap[project.priority] || '5'
        };

        let event;

        if (project.googleCalendarEventId) {
            // Update existing event
            event = await calendar.events.update({
                calendarId: 'primary',
                eventId: project.googleCalendarEventId,
                resource: eventData
            });
        } else {
            // Create new event
            event = await calendar.events.insert({
                calendarId: 'primary',
                resource: eventData
            });

            // Save the event ID on the project
            project.googleCalendarEventId = event.data.id;
            await project.save();
        }

        res.json(event.data);
    } catch (error) {
        res.status(500);
        throw new Error(`Failed to sync project to calendar: ${error.message}`);
    }
});
