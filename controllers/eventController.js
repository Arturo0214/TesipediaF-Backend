import Event from '../models/Event.js';

// ─── Helper: detect device from user-agent ───
const getDevice = (ua = '') => {
  const lower = ua.toLowerCase();
  if (/tablet|ipad/.test(lower)) return 'tablet';
  if (/mobile|android|iphone|ipod/.test(lower)) return 'mobile';
  return 'desktop';
};

// ─── POST /events/track ─── (público, acepta array o evento individual)
export const trackEvent = async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const device = getDevice(userAgent);
    const referrer = req.headers['referer'] || '';

    const events = Array.isArray(req.body) ? req.body : [req.body];

    const docs = events.map(ev => ({
      sessionId: ev.sessionId || 'unknown',
      type: ev.type || 'custom',
      category: ev.category || 'general',
      action: ev.action || 'unknown',
      label: ev.label || '',
      value: ev.value ?? null,
      page: ev.page || '/',
      element: ev.element || '',
      metadata: ev.metadata || {},
      ip,
      userAgent,
      referrer,
      device,
    }));

    await Event.insertMany(docs, { ordered: false });
    res.status(201).json({ ok: true, count: docs.length });
  } catch (err) {
    console.error('Error tracking event:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /events/feed ─── (admin — últimos N eventos en orden cronológico)
export const getEventFeed = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const page = parseInt(req.query.page) || 1;
    const typeFilter = req.query.type || null;
    const since = req.query.since ? new Date(req.query.since) : null;

    const query = {};
    if (typeFilter) query.type = typeFilter;
    if (since) query.createdAt = { $gte: since };

    const [events, total] = await Promise.all([
      Event.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Event.countDocuments(query),
    ]);

    res.json({ events, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /events/stats ─── (admin — resumen de analytics por periodo)
export const getEventStats = async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [
      totalEvents,
      recentEvents,
      byType,
      byAction,
      byPage,
      byDevice,
      activeSessions,
      hourlyBreakdown,
    ] = await Promise.all([
      Event.countDocuments(),
      Event.countDocuments({ createdAt: { $gte: since } }),
      // Eventos por tipo
      Event.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // Top acciones (clicks más frecuentes)
      Event.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { action: '$action', label: '$label', page: '$page' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      // Páginas con más eventos
      Event.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$page', count: { $sum: 1 }, uniqueSessions: { $addToSet: '$sessionId' } } },
        { $addFields: { sessions: { $size: '$uniqueSessions' } } },
        { $project: { uniqueSessions: 0 } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      // Por dispositivo
      Event.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // Sesiones activas (únicas en las últimas N horas)
      Event.distinct('sessionId', { createdAt: { $gte: since } }),
      // Eventos por hora (últimas 24h)
      Event.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      totalEvents,
      recentEvents,
      activeSessions: activeSessions.length,
      byType,
      byAction: byAction.map(a => ({
        action: a._id.action,
        label: a._id.label,
        page: a._id.page,
        count: a.count,
      })),
      byPage: byPage.map(p => ({ page: p._id, events: p.count, sessions: p.sessions })),
      byDevice,
      hourlyBreakdown: hourlyBreakdown.map(h => ({ hour: h._id, count: h.count })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /events/realtime ─── (admin — sesiones activas en los últimos 5 min)
export const getRealtimeData = async (req, res) => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const [activeSessions, recentEvents, activeByPage] = await Promise.all([
      // Sesiones con actividad en últimos 5 min
      Event.aggregate([
        { $match: { createdAt: { $gte: fiveMinAgo } } },
        {
          $group: {
            _id: '$sessionId',
            lastEvent: { $max: '$createdAt' },
            page: { $last: '$page' },
            device: { $last: '$device' },
            eventCount: { $sum: 1 },
          },
        },
        { $sort: { lastEvent: -1 } },
      ]),
      // Últimos 20 eventos
      Event.find({ createdAt: { $gte: thirtyMinAgo } })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      // Usuarios activos por página
      Event.aggregate([
        { $match: { createdAt: { $gte: fiveMinAgo } } },
        { $group: { _id: '$page', sessions: { $addToSet: '$sessionId' } } },
        { $addFields: { activeUsers: { $size: '$sessions' } } },
        { $project: { sessions: 0 } },
        { $sort: { activeUsers: -1 } },
      ]),
    ]);

    res.json({
      activeUsers: activeSessions.length,
      activeSessions,
      recentEvents,
      activeByPage: activeByPage.map(p => ({ page: p._id, users: p.activeUsers })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
