import { google } from 'googleapis';
import GoogleCalendarToken from '../models/GoogleCalendarToken.js';

// Crear un OAuth2 client base (shared config, credentials per-admin)
const createOAuth2Client = () => new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

const oauth2Client = createOAuth2Client();

// ── Legacy in-memory tokens (fallback) ──
let tokens = null;

export const getAuthUrl = (adminKey) => {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
        ],
        state: adminKey || 'arturo', // pasar adminKey como state para el callback
    });
};

// ── Per-admin token management (MongoDB) ──

export const saveAdminTokens = async (adminKey, tokenData, email = '') => {
    await GoogleCalendarToken.findOneAndUpdate(
        { adminKey },
        {
            adminKey,
            googleEmail: email,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || undefined,
            expiryDate: tokenData.expiry_date || null,
        },
        { upsert: true, new: true }
    );
    // Mantener legacy in-memory para compatibilidad
    if (adminKey === 'arturo') {
        tokens = tokenData;
        oauth2Client.setCredentials(tokenData);
    }
};

export const getAdminTokens = async (adminKey) => {
    const doc = await GoogleCalendarToken.findOne({ adminKey });
    if (!doc) return null;
    return {
        access_token: doc.accessToken,
        refresh_token: doc.refreshToken,
        expiry_date: doc.expiryDate,
    };
};

export const getAdminCalendarClient = async (adminKey) => {
    const tokenData = await getAdminTokens(adminKey);
    if (!tokenData) throw new Error(`Google Calendar no conectado para ${adminKey}`);
    const client = createOAuth2Client();
    client.setCredentials(tokenData);
    // Auto-refresh: guardar nuevos tokens cuando se refresquen
    client.on('tokens', async (newTokens) => {
        const merged = { ...tokenData, ...newTokens };
        await saveAdminTokens(adminKey, merged);
    });
    return google.calendar({ version: 'v3', auth: client });
};

export const getAdminOAuth2Client = async (adminKey) => {
    const tokenData = await getAdminTokens(adminKey);
    if (!tokenData) return null;
    const client = createOAuth2Client();
    client.setCredentials(tokenData);
    return client;
};

export const getAllConnectedAdmins = async () => {
    return GoogleCalendarToken.find({}).select('adminKey adminLabel googleEmail autoSync updatedAt').lean();
};

// ── Legacy single-admin functions (backward compat) ──
export const setTokens = (newTokens) => {
    tokens = newTokens;
    oauth2Client.setCredentials(tokens);
};

export const getTokens = () => tokens;

export const isAuthenticated = () => {
    return tokens !== null && tokens.access_token;
};

export const getCalendarClient = () => {
    if (!tokens) throw new Error('Google Calendar not authenticated');
    oauth2Client.setCredentials(tokens);
    return google.calendar({ version: 'v3', auth: oauth2Client });
};

export { oauth2Client };
