import { google } from 'googleapis';

// ─── Configuration ───
const SITE_URL = process.env.SEARCH_CONSOLE_SITE_URL || 'https://tesipedia.com';

let authClient = null;

const getAuth = () => {
  if (authClient) return authClient;

  if (process.env.GA_CLIENT_EMAIL && process.env.GA_PRIVATE_KEY) {
    // Production: use same service account as GA4
    authClient = new google.auth.JWT(
      process.env.GA_CLIENT_EMAIL,
      null,
      process.env.GA_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/webmasters.readonly'],
    );
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Local: use service account JSON file
    authClient = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
  }

  return authClient;
};

/**
 * Helper: format date as YYYY-MM-DD
 */
const fmtDate = (date) => date.toISOString().split('T')[0];

/**
 * Get top search queries (keywords) from Google Search Console
 */
export const getSearchQueries = async (days = 28) => {
  const auth = getAuth();
  if (!auth) throw new Error('Search Console auth not configured');

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      dimensions: ['query'],
      rowLimit: 20,
      type: 'web',
    },
  });

  const rows = (response.data.rows || []).map(row => ({
    query: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 10000) / 100, // Convert to percentage with 2 decimals
    position: Math.round(row.position * 10) / 10,
  }));

  return rows;
};

/**
 * Get top landing pages from organic search
 */
export const getSearchPages = async (days = 28) => {
  const auth = getAuth();
  if (!auth) throw new Error('Search Console auth not configured');

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      dimensions: ['page'],
      rowLimit: 15,
      type: 'web',
    },
  });

  const rows = (response.data.rows || []).map(row => ({
    page: row.keys[0].replace(SITE_URL, '') || '/',
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 10000) / 100,
    position: Math.round(row.position * 10) / 10,
  }));

  return rows;
};

/**
 * Get search console summary (totals)
 */
export const getSearchSummary = async (days = 28) => {
  const auth = getAuth();
  if (!auth) throw new Error('Search Console auth not configured');

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      type: 'web',
    },
  });

  const rows = response.data.rows || [];
  if (rows.length === 0) {
    return { totalClicks: 0, totalImpressions: 0, avgCTR: 0, avgPosition: 0 };
  }

  const row = rows[0];
  return {
    totalClicks: row.clicks,
    totalImpressions: row.impressions,
    avgCTR: Math.round(row.ctr * 10000) / 100,
    avgPosition: Math.round(row.position * 10) / 10,
  };
};

/**
 * All-in-one: queries + pages + summary
 */
export const getSearchConsoleData = async (days = 28) => {
  const [queries, pages, summary] = await Promise.allSettled([
    getSearchQueries(days),
    getSearchPages(days),
    getSearchSummary(days),
  ]);

  return {
    queries: queries.status === 'fulfilled' ? queries.value : [],
    pages: pages.status === 'fulfilled' ? pages.value : [],
    summary: summary.status === 'fulfilled' ? summary.value : null,
  };
};
