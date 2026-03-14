import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Token storage - in production, store in DB
let tokens = null;

export const getAuthUrl = () => {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ]
    });
};

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
