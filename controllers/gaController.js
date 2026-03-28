import {
  getOverview,
  getRealtime,
  getTopPages,
  getEventBreakdown,
  getAcquisitionChannels,
  getUsersByCountry,
  getUserTimeline,
  getDeviceBreakdown,
  getTrafficSources,
} from '../services/googleAnalyticsService.js';
import { getSearchConsoleData } from '../services/googleSearchConsoleService.js';

// ─── GET /ga/overview ───
export const gaOverview = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 28;
    const data = await getOverview(days);
    res.json(data);
  } catch (err) {
    console.error('GA Overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/realtime ───
export const gaRealtime = async (req, res) => {
  try {
    const data = await getRealtime();
    res.json(data);
  } catch (err) {
    console.error('GA Realtime error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/pages ───
export const gaTopPages = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await getTopPages(days);
    res.json(data);
  } catch (err) {
    console.error('GA Pages error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/events ───
export const gaEvents = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await getEventBreakdown(days);
    res.json(data);
  } catch (err) {
    console.error('GA Events error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/channels ───
export const gaChannels = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await getAcquisitionChannels(days);
    res.json(data);
  } catch (err) {
    console.error('GA Channels error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/countries ───
export const gaCountries = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await getUsersByCountry(days);
    res.json(data);
  } catch (err) {
    console.error('GA Countries error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/timeline ───
export const gaTimeline = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await getUserTimeline(days);
    res.json(data);
  } catch (err) {
    console.error('GA Timeline error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/devices ───
export const gaDevices = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await getDeviceBreakdown(days);
    res.json(data);
  } catch (err) {
    console.error('GA Devices error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /ga/dashboard ─── (all-in-one endpoint to reduce calls)
export const gaDashboard = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;

    const [overview, realtime, pages, events, channels, countries, devices, sources, timeline, searchConsole] = await Promise.allSettled([
      getOverview(days),
      getRealtime(),
      getTopPages(days),
      getEventBreakdown(days),
      getAcquisitionChannels(days),
      getUsersByCountry(days),
      getDeviceBreakdown(days),
      getTrafficSources(days),
      getUserTimeline(days),
      getSearchConsoleData(days),
    ]);

    res.json({
      overview: overview.status === 'fulfilled' ? overview.value : null,
      realtime: realtime.status === 'fulfilled' ? realtime.value : null,
      pages: pages.status === 'fulfilled' ? pages.value : null,
      events: events.status === 'fulfilled' ? events.value : null,
      channels: channels.status === 'fulfilled' ? channels.value : null,
      countries: countries.status === 'fulfilled' ? countries.value : null,
      devices: devices.status === 'fulfilled' ? devices.value : null,
      sources: sources.status === 'fulfilled' ? sources.value : null,
      timeline: timeline.status === 'fulfilled' ? timeline.value : null,
      searchConsole: searchConsole.status === 'fulfilled' ? searchConsole.value : null,
    });
  } catch (err) {
    console.error('GA Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
