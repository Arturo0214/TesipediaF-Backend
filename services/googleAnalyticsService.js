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
 * Timeline de usuarios activos por día (o por hora si days <= 1)
 */
export const getUserTimeline = async (days = 30) => {
  // For 1-day view, use dateHour dimension for hourly granularity
  if (days <= 1) {
    const response = await runReport({
      dateRanges: [{ startDate: 'today', endDate: 'today' }],
      dimensions: [{ name: 'dateHour' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
      ],
      orderBys: [{ dimension: { dimensionName: 'dateHour' } }],
    });
    const rows = parseRows(response, ['dateHour'], ['users', 'sessions', 'pageViews']);
    // Mark as hourly so the frontend knows
    return { type: 'hourly', rows };
  }

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
  const rows = parseRows(response, ['date'], ['users', 'sessions', 'pageViews']);
  return { type: 'daily', rows };
};

/**
 * Fuentes de tráfico (source/medium) para ver de dónde llegan las visitas
 */
export const getTrafficSources = async (days = 7) => {
  const response = await runReport({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [
      { name: 'sessionSource' },
      { name: 'sessionMedium' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'bounceRate' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 15,
  });
  return parseRows(response, ['source', 'medium'], ['sessions', 'users', 'newUsers', 'bounceRate']);
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

/**
 * Tráfico de Google: todo el tráfico que viene de Google (orgánico + pagado + otros)
 * Devuelve totales, desglose por medio, y comparación con periodo anterior
 */
export const getGoogleTraffic = async (days = 7) => {
  // 1. Get Google traffic broken down by medium (organic, cpc, referral, etc.)
  const byMediumResponse = await runReport({
    dateRanges: [
      { startDate: `${days}daysAgo`, endDate: 'today' },
      { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
    ],
    dimensions: [{ name: 'sessionMedium' }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'sessionSource',
        stringFilter: { value: 'google', matchType: 'EXACT' },
      },
    },
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });

  // Parse current period rows
  const byMedium = [];
  let totalCurrent = { sessions: 0, users: 0, newUsers: 0, pageViews: 0, bounceRate: 0, avgDuration: 0 };
  let totalPrevious = { sessions: 0, users: 0 };
  let mediumCount = 0;

  if (byMediumResponse.rows) {
    byMediumResponse.rows.forEach(row => {
      const medium = row.dimensionValues[0].value;
      const currentMetrics = row.metricValues.slice(0, 6);
      const sessions = Number(currentMetrics[0].value);
      const users = Number(currentMetrics[1].value);
      const newUsers = Number(currentMetrics[2].value);
      const pageViews = Number(currentMetrics[3].value);
      const bounceRate = Number(currentMetrics[4].value);
      const avgDuration = Number(currentMetrics[5].value);

      // Previous period metrics (offset by 6)
      const prevSessions = row.metricValues.length > 6 ? Number(row.metricValues[6].value) : 0;
      const prevUsers = row.metricValues.length > 7 ? Number(row.metricValues[7].value) : 0;

      byMedium.push({
        medium,
        label: medium === 'organic' ? 'Búsqueda Orgánica' :
               medium === 'cpc' ? 'Google Ads (Pagado)' :
               medium === 'referral' ? 'Referencia' :
               medium === '(none)' ? 'Directo' : medium,
        sessions,
        users,
        newUsers,
        pageViews,
        bounceRate: Math.round(bounceRate * 100) / 100,
        avgDuration: Math.round(avgDuration),
        prevSessions,
        prevUsers,
        growth: prevSessions > 0 ? Math.round(((sessions - prevSessions) / prevSessions) * 100) : (sessions > 0 ? 100 : 0),
      });

      totalCurrent.sessions += sessions;
      totalCurrent.users += users;
      totalCurrent.newUsers += newUsers;
      totalCurrent.pageViews += pageViews;
      totalCurrent.bounceRate += bounceRate;
      totalCurrent.avgDuration += avgDuration;
      totalPrevious.sessions += prevSessions;
      totalPrevious.users += prevUsers;
      mediumCount++;
    });
  }

  if (mediumCount > 0) {
    totalCurrent.bounceRate = Math.round((totalCurrent.bounceRate / mediumCount) * 100) / 100;
    totalCurrent.avgDuration = Math.round(totalCurrent.avgDuration / mediumCount);
  }

  // 2. Get Google traffic timeline (daily or hourly)
  const timelineDim = days <= 1 ? 'dateHour' : 'date';
  const timelineResponse = await runReport({
    dateRanges: [{ startDate: days <= 1 ? 'today' : `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: timelineDim }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'sessionSource',
        stringFilter: { value: 'google', matchType: 'EXACT' },
      },
    },
    orderBys: [{ dimension: { dimensionName: timelineDim } }],
  });

  const timeline = parseRows(
    timelineResponse,
    [timelineDim],
    ['sessions', 'users']
  );

  return {
    total: totalCurrent,
    previous: totalPrevious,
    growth: totalPrevious.sessions > 0
      ? Math.round(((totalCurrent.sessions - totalPrevious.sessions) / totalPrevious.sessions) * 100)
      : (totalCurrent.sessions > 0 ? 100 : 0),
    byMedium,
    timeline: {
      type: days <= 1 ? 'hourly' : 'daily',
      rows: timeline,
    },
  };
};
