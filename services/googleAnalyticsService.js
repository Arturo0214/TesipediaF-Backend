import { BetaAnalyticsDataClient } from '@google-analytics/data';

// ─── Configuration ───
// GA4 Property ID (from your GA4 dashboard URL: p493750297)
const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID || '493750297';

// Initialize the client
// Authenticates via GOOGLE_APPLICATION_CREDENTIALS env var (path to service account JSON)
// OR via GA_CLIENT_EMAIL + GA_PRIVATE_KEY env vars for Railway/production
let analyticsClient = null;

const getClient = () => {
  if (analyticsClient) return analyticsClient;

  if (process.env.GA_CLIENT_EMAIL && process.env.GA_PRIVATE_KEY) {
    // Production: use env vars directly
    analyticsClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: process.env.GA_CLIENT_EMAIL,
        private_key: process.env.GA_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
    });
  } else {
    // Local: uses GOOGLE_APPLICATION_CREDENTIALS env var
    analyticsClient = new BetaAnalyticsDataClient();
  }

  return analyticsClient;
};

// ─── Helper: run a GA4 report ───
const runReport = async (config) => {
  const client = getClient();
  const [response] = await client.runReport({
    property: `properties/${GA_PROPERTY_ID}`,
    ...config,
  });
  return response;
};

// ─── Helper: run a GA4 realtime report ───
const runRealtimeReport = async (config) => {
  const client = getClient();
  const [response] = await client.runRealtimeReport({
    property: `properties/${GA_PROPERTY_ID}`,
    ...config,
  });
  return response;
};

// ─── Helper: parse rows into clean objects ───
const parseRows = (response, dimNames, metricNames) => {
  if (!response.rows) return [];
  return response.rows.map(row => {
    const obj = {};
    (row.dimensionValues || []).forEach((val, i) => {
      obj[dimNames[i]] = val.value;
    });
    (row.metricValues || []).forEach((val, i) => {
      obj[metricNames[i]] = Number(val.value);
    });
    return obj;
  });
};

// ═══════════════════════════════════════════════════════════
// PUBLIC METHODS
// ═══════════════════════════════════════════════════════════

/**
 * Resumen general: usuarios activos, sesiones, eventos, pageviews (últimos 28 días vs periodo anterior)
 */
export const getOverview = async (days = 28) => {
  const response = await runReport({
    dateRanges: [
      { startDate: `${days}daysAgo`, endDate: 'today' },
      { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
    ],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'eventCount' },
      { name: 'screenPageViews' },
      { name: 'newUsers' },
      { name: 'averageSessionDuration' },
      { name: 'engagedSessions' },
      { name: 'bounceRate' },
    ],
  });

  const current = {};
  const previous = {};
  const metricNames = ['activeUsers', 'sessions', 'eventCount', 'pageViews', 'newUsers', 'avgSessionDuration', 'engagedSessions', 'bounceRate'];

  if (response.rows && response.rows.length > 0) {
    response.rows[0].metricValues.forEach((val, i) => {
      current[metricNames[i]] = Number(val.value);
    });
  }
  if (response.rows && response.rows.length > 1) {
    response.rows[1].metricValues.forEach((val, i) => {
      previous[metricNames[i]] = Number(val.value);
    });
  }

  // Calculate growth percentages
  const growth = {};
  metricNames.forEach(m => {
    const prev = previous[m] || 0;
    const curr = current[m] || 0;
    growth[m] = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0);
  });

  return { current, previous, growth, days };
};

/**
 * Usuarios activos en tiempo real
 */
export const getRealtime = async () => {
  const response = await runRealtimeReport({
    metrics: [{ name: 'activeUsers' }],
    dimensions: [{ name: 'country' }],
  });

  const byCountry = parseRows(response, ['country'], ['activeUsers']);
  const totalActive = byCountry.reduce((sum, r) => sum + r.activeUsers, 0);

  // También por página
  const byPage = await runRealtimeReport({
    metrics: [{ name: 'activeUsers' }],
    dimensions: [{ name: 'unifiedScreenName' }],
  });
  const pageData = parseRows(byPage, ['page'], ['activeUsers']);

  // Por fuente de tráfico
  const bySource = await runRealtimeReport({
    metrics: [{ name: 'activeUsers' }],
    dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
  });
  const sourceData = parseRows(bySource, ['channel'], ['activeUsers']);

  return { totalActive, byCountry, byPage: pageData, bySource: sourceData };
};

/**
 * Top páginas con vistas, sesiones, bounce rate
 */
export const getTopPages = async (days = 7) => {
  const response = await runReport({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 15,
  });
  return parseRows(response, ['page'], ['views', 'sessions', 'users', 'avgDuration', 'bounceRate']);
};

/**
 * Eventos por nombre (click, scroll, page_view, etc.)
 */
export const getEventBreakdown = async (days = 7) => {
  const response = await runReport({
    dateRanges: [
      { startDate: `${days}daysAgo`, endDate: 'today' },
      { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
    ],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 20,
  });

  const current = parseRows(
    { rows: response.rows?.filter((_, i) => response.rows[i]?.dimensionValues) },
    ['event'], ['count']
  );

  // Parse both date ranges
  const results = [];
  if (response.rows) {
    response.rows.forEach(row => {
      const event = row.dimensionValues[0].value;
      const currentVal = Number(row.metricValues[0].value);
      // Second date range value
      const prevVal = row.metricValues.length > 1 ? Number(row.metricValues[1].value) : 0;
      const growth = prevVal > 0 ? Math.round(((currentVal - prevVal) / prevVal) * 100) : (currentVal > 0 ? 100 : 0);
      results.push({ event, count: currentVal, previous: prevVal, growth });
    });
  }
  return results;
};

/**
 * Canales de adquisición (Direct, Organic Search, Social, etc.)
 */
export const getAcquisitionChannels = async (days = 7) => {
  const response = await runReport({
    dateRanges: [
      { startDate: `${days}daysAgo`, endDate: 'today' },
      { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
    ],
    dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
    metrics: [
      { name: 'sessions' },
      { name: 'newUsers' },
      { name: 'activeUsers' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });

  const results = [];
  if (response.rows) {
    response.rows.forEach(row => {
      const channel = row.dimensionValues[0].value;
      const sessions = Number(row.metricValues[0].value);
      const newUsers = Number(row.metricValues[1].value);
      const users = Number(row.metricValues[2].value);
      const prevSessions = row.metricValues.length > 3 ? Number(row.metricValues[3].value) : 0;
      results.push({ channel, sessions, newUsers, users, prevSessions });
    });
  }
  return results;
};

/**
 * Usuarios nuevos por país
 */
export const getUsersByCountry = async (days = 7) => {
  const response = await runReport({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'country' }],
    metrics: [
      { name: 'newUsers' },
      { name: 'activeUsers' },
      { name: 'sessions' },
    ],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 15,
  });
  return parseRows(response, ['country'], ['newUsers', 'activeUsers', 'sessions']);
};

/**
 * Timeline de usuarios activos por día
 */
export const getUserTimeline = async (days = 30) => {
  const response = await runReport({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });
  return parseRows(response, ['date'], ['users', 'sessions', 'pageViews']);
};

/**
 * Dispositivos
 */
export const getDeviceBreakdown = async (days = 7) => {
  const response = await runReport({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
    ],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
  });
  return parseRows(response, ['device'], ['users', 'sessions']);
};
