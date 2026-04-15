import asyncHandler from 'express-async-handler';
import { google } from 'googleapis';
import {
    getAuthUrl,
    oauth2Client,
    saveAdminTokens,
    getAdminTokens,
    getAdminCalendarClient,
    getAdminOAuth2Client,
    getAllConnectedAdmins,
    // Legacy
    setTokens,
    isAuthenticated,
    getCalendarClient,
} from '../config/googleCalendar.js';
import GoogleCalendarToken from '../models/GoogleCalendarToken.js';
import Project from '../models/Project.js';

const TZ = 'America/Mexico_City';

const COLOR_MAP = {
    'low': '3',      // Blue
    'medium': '5',   // Yellow
    'high': '6',     // Red
    'urgent': '11',  // Tomato
};

// ════════════════════════════════════════════
// MULTI-ADMIN ENDPOINTS
// ════════════════════════════════════════════

// GET /google/admins — listar admins conectados
export const getConnectedAdmins = asyncHandler(async (req, res) => {
    const admins = await getAllConnectedAdmins();
    res.json(admins);
});

// GET /google/auth-url?admin=arturo — obtener URL OAuth para un admin
export const getAuthUrlEndpoint = asyncHandler(async (req, res) => {
    const adminKey = (req.query.admin || 'arturo').toLowerCase().trim();
    const authUrl = getAuthUrl(adminKey);
    res.json({ authUrl, adminKey });
});

// GET /google/callback?code=...&state=adminKey — OAuth callback
export const handleCallback = asyncHandler(async (req, res) => {
    const { code, state } = req.query;
    const adminKey = (state || 'arturo').toLowerCase().trim();

    if (!code) {
        res.status(400);
        throw new Error('Authorization code not provided');
    }

    const { tokens } = await oauth2Client.getToken(code);

    // Obtener email del usuario
    const tempClient = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    tempClient.setCredentials(tokens);
    let email = '';
    try {
        const oauth2 = google.oauth2({ version: 'v2', auth: tempClient });
        const { data } = await oauth2.userinfo.get();
        email = data.email || '';
    } catch (e) { /* ignore */ }

    // Guardar tokens en MongoDB
    await saveAdminTokens(adminKey, tokens, email);

    // Si es arturo, habilitar autoSync por default
    if (adminKey === 'arturo') {
        await GoogleCalendarToken.findOneAndUpdate({ adminKey }, { autoSync: true });
        // Legacy compat
        setTokens(tokens);
    }

    // Redirect al frontend
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/admin/calendarios?connected=${adminKey}&email=${encodeURIComponent(email)}`);
});

// GET /google/status?admin=arturo — estado de conexión de un admin
export const getConnectionStatus = asyncHandler(async (req, res) => {
    const adminKey = (req.query.admin || '').toLowerCase().trim();

    if (adminKey) {
        const tokenData = await getAdminTokens(adminKey);
        if (!tokenData) return res.json({ connected: false });

        let email = '';
        try {
            const client = await getAdminOAuth2Client(adminKey);
            const oauth2 = google.oauth2({ version: 'v2', auth: client });
            const { data } = await oauth2.userinfo.get();
            email = data.email || '';
        } catch (e) { /* ignore */ }

        const doc = await GoogleCalendarToken.findOne({ adminKey }).select('autoSync').lean();
        return res.json({ connected: true, email, autoSync: doc?.autoSync || false });
    }

    // Legacy: single-admin
    const connected = isAuthenticated();
    res.json({ connected });
});

// POST /google/toggle-autosync — activar/desactivar autosync
export const toggleAutoSync = asyncHandler(async (req, res) => {
    const { adminKey, autoSync } = req.body;
    if (!adminKey) return res.status(400).json({ error: 'adminKey requerido' });

    const doc = await GoogleCalendarToken.findOneAndUpdate(
        { adminKey },
        { autoSync: !!autoSync },
        { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Admin no conectado' });
    res.json({ adminKey, autoSync: doc.autoSync });
});

// POST /google/disconnect — desconectar calendario de un admin
export const disconnectAdmin = asyncHandler(async (req, res) => {
    const { adminKey } = req.body;
    if (!adminKey) return res.status(400).json({ error: 'adminKey requerido' });

    await GoogleCalendarToken.deleteOne({ adminKey });
    res.json({ success: true });
});

// GET /google/events?admin=arturo&timeMin=...&timeMax=...
export const getCalendarEvents = asyncHandler(async (req, res) => {
    const adminKey = (req.query.admin || 'arturo').toLowerCase().trim();
    const { timeMin, timeMax } = req.query;

    let calendar;
    try {
        calendar = await getAdminCalendarClient(adminKey);
    } catch (e) {
        // Fallback a legacy
        if (!isAuthenticated()) {
            res.status(401);
            throw new Error('Google Calendar no conectado para ' + adminKey);
        }
        calendar = getCalendarClient();
    }

    const events = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin || new Date().toISOString(),
        timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        showDeleted: false,
        singleEvents: true,
        orderBy: 'startTime',
    });

    res.json(events.data);
});

// POST /google/events — crear evento en calendario de un admin
export const createCalendarEvent = asyncHandler(async (req, res) => {
    const { adminKey, summary, description, startDate, endDate, startTime, colorId } = req.body;
    const admin = (adminKey || 'arturo').toLowerCase().trim();

    const calendar = await getAdminCalendarClient(admin);

    const event = {
        summary,
        description: description || '',
        colorId: colorId || '5',
    };

    if (startTime) {
        event.start = { dateTime: `${startDate}T${startTime}:00`, timeZone: TZ };
        const endDt = endDate || startDate;
        const endTm = req.body.endTime || `${String(Number(startTime.split(':')[0]) + 1).padStart(2, '0')}:${startTime.split(':')[1]}`;
        event.end = { dateTime: `${endDt}T${endTm}:00`, timeZone: TZ };
    } else {
        event.start = { date: startDate };
        event.end = { date: endDate || startDate };
    }

    const created = await calendar.events.insert({ calendarId: 'primary', resource: event });
    res.status(201).json(created.data);
});

// PUT /google/events/:eventId — actualizar evento
export const updateCalendarEvent = asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const admin = (req.body.adminKey || 'arturo').toLowerCase().trim();

    const calendar = await getAdminCalendarClient(admin);

    const { summary, description, startDate, endDate, startTime, colorId } = req.body;
    const event = { summary, description: description || '', colorId: colorId || '5' };

    if (startTime) {
        event.start = { dateTime: `${startDate}T${startTime}:00`, timeZone: TZ };
        const endTm = req.body.endTime || `${String(Number(startTime.split(':')[0]) + 1).padStart(2, '0')}:${startTime.split(':')[1]}`;
        event.end = { dateTime: `${endDate || startDate}T${endTm}:00`, timeZone: TZ };
    } else {
        event.start = { date: startDate };
        event.end = { date: endDate || startDate };
    }

    const updated = await calendar.events.update({ calendarId: 'primary', eventId, resource: event });
    res.json(updated.data);
});

// DELETE /google/events/:eventId?admin=arturo
export const deleteCalendarEvent = asyncHandler(async (req, res) => {
    const admin = (req.query.admin || 'arturo').toLowerCase().trim();
    const calendar = await getAdminCalendarClient(admin);
    await calendar.events.delete({ calendarId: 'primary', eventId: req.params.eventId });
    await Project.findOneAndUpdate({ googleCalendarEventId: req.params.eventId }, { googleCalendarEventId: null });
    res.json({ success: true });
});

// ════════════════════════════════════════════
// AUTO-SYNC: Proyecto/Pago → Google Calendar
// ════════════════════════════════════════════

/**
 * Sincronizar un proyecto al calendario de todos los admins con autoSync=true.
 * Llamar esto cada vez que se crea o actualiza un proyecto.
 */
export const autoSyncProject = async (project) => {
    try {
        const autoSyncAdmins = await GoogleCalendarToken.find({ autoSync: true }).lean();
        if (autoSyncAdmins.length === 0) return;

        if (!project.dueDate) return;

        const summary = `📋 ${project.taskTitle || project.taskType || 'Proyecto'}`;
        const description = [
            `Cliente: ${project.clientName || project.client?.name || 'N/A'}`,
            project.taskType ? `Tipo: ${project.taskType}` : '',
            project.career ? `Carrera: ${project.career}` : '',
            project.clientPhone ? `Tel: ${project.clientPhone}` : '',
            `Estado: ${project.status || 'pending'}`,
        ].filter(Boolean).join('\n');

        const eventData = {
            summary,
            description,
            start: { date: new Date(project.dueDate).toISOString().split('T')[0] },
            end: { date: new Date(project.dueDate).toISOString().split('T')[0] },
            colorId: COLOR_MAP[project.priority] || '5',
        };

        for (const admin of autoSyncAdmins) {
            try {
                const calendar = await getAdminCalendarClient(admin.adminKey);

                if (project.googleCalendarEventId) {
                    // Actualizar evento existente
                    await calendar.events.update({
                        calendarId: 'primary',
                        eventId: project.googleCalendarEventId,
                        resource: eventData,
                    });
                } else {
                    // Crear nuevo evento
                    const created = await calendar.events.insert({
                        calendarId: 'primary',
                        resource: eventData,
                    });
                    // Solo guardar el eventId del primer admin (arturo)
                    if (admin.adminKey === 'arturo' && !project.googleCalendarEventId) {
                        project.googleCalendarEventId = created.data.id;
                        await project.save();
                    }
                }
            } catch (err) {
                console.warn(`[AutoSync] Error syncing project to ${admin.adminKey}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[AutoSync] Project sync error:', err.message);
    }
};

/**
 * Sincronizar parcialidades de pago al calendario.
 * Crea un evento por cada parcialidad pendiente.
 */
export const autoSyncPaymentSchedule = async (payment) => {
    try {
        const autoSyncAdmins = await GoogleCalendarToken.find({ autoSync: true }).lean();
        if (autoSyncAdmins.length === 0) return;

        const schedule = payment.schedule || [];
        if (schedule.length <= 1) return; // pago único, no crear eventos

        for (const inst of schedule) {
            if (!inst.dueDate || inst.status === 'paid') continue;

            const summary = `💰 Pago: ${payment.clientName} — ${inst.label}`;
            const description = [
                `Monto: $${(inst.amount || 0).toLocaleString('es-MX')}`,
                `Proyecto: ${payment.title || 'N/A'}`,
                payment.clientPhone ? `Tel: ${payment.clientPhone}` : '',
            ].filter(Boolean).join('\n');

            const eventData = {
                summary,
                description,
                start: { date: new Date(inst.dueDate).toISOString().split('T')[0] },
                end: { date: new Date(inst.dueDate).toISOString().split('T')[0] },
                colorId: '10', // Verde salvia para pagos
            };

            for (const admin of autoSyncAdmins) {
                try {
                    const calendar = await getAdminCalendarClient(admin.adminKey);
                    await calendar.events.insert({ calendarId: 'primary', resource: eventData });
                } catch (err) {
                    console.warn(`[AutoSync] Error syncing payment to ${admin.adminKey}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('[AutoSync] Payment sync error:', err.message);
    }
};

// POST /google/sync-project/:projectId — sync manual de un proyecto
export const syncProjectToCalendar = asyncHandler(async (req, res) => {
    const admin = (req.body.adminKey || 'arturo').toLowerCase().trim();
    const project = await Project.findById(req.params.projectId).populate('client', 'name email phone');

    if (!project) { res.status(404); throw new Error('Proyecto no encontrado'); }

    const calendar = await getAdminCalendarClient(admin);

    const eventData = {
        summary: `📋 ${project.taskTitle || project.taskType || 'Proyecto'}`,
        description: [
            `Cliente: ${project.clientName || project.client?.name || 'N/A'}`,
            project.taskType ? `Tipo: ${project.taskType}` : '',
            project.career ? `Carrera: ${project.career}` : '',
        ].filter(Boolean).join('\n'),
        start: { date: project.dueDate.toISOString().split('T')[0] },
        end: { date: project.dueDate.toISOString().split('T')[0] },
        colorId: COLOR_MAP[project.priority] || '5',
    };

    let event;
    if (project.googleCalendarEventId) {
        event = await calendar.events.update({ calendarId: 'primary', eventId: project.googleCalendarEventId, resource: eventData });
    } else {
        event = await calendar.events.insert({ calendarId: 'primary', resource: eventData });
        project.googleCalendarEventId = event.data.id;
        await project.save();
    }

    res.json(event.data);
});

// POST /google/schedule-call — agendar llamada desde WhatsApp
export const scheduleCall = asyncHandler(async (req, res) => {
    const { adminKey, clientName, clientPhone, date, time, notes } = req.body;
    const admin = (adminKey || 'arturo').toLowerCase().trim();

    if (!date || !time) { res.status(400); throw new Error('Fecha y hora requeridas'); }

    const calendar = await getAdminCalendarClient(admin);

    const startHour = parseInt(time.split(':')[0]);
    const endTime = `${String(startHour + 1).padStart(2, '0')}:${time.split(':')[1]}`;

    const event = await calendar.events.insert({
        calendarId: 'primary',
        resource: {
            summary: `📞 Llamada: ${clientName || 'Lead'}`,
            description: [
                clientPhone ? `Teléfono: ${clientPhone}` : '',
                clientPhone ? `WhatsApp: https://wa.me/${clientPhone.replace(/\D/g, '')}` : '',
                notes ? `Notas: ${notes}` : '',
            ].filter(Boolean).join('\n'),
            start: { dateTime: `${date}T${time}:00`, timeZone: TZ },
            end: { dateTime: `${date}T${endTime}:00`, timeZone: TZ },
            colorId: '7', // Pavo real (llamadas)
            reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
        },
    });

    res.status(201).json({ success: true, event: event.data });
});
