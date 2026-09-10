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

    const docs = events.map(ev => {
      const a = ev.attribution || {};
      const utm = a.utm || {};
      return {
        sessionId: ev.sessionId || 'unknown',
        visitorId: ev.visitorId || a.visitorId || '',
        source: ev.source || a.source || '',
        utm: {
          source: utm.utm_source || utm.source || '',
          medium: utm.utm_medium || utm.medium || '',
          campaign: utm.utm_campaign || utm.campaign || '',
          content: utm.utm_content || utm.content || '',
          term: utm.utm_term || utm.term || '',
          fbclid: utm.fbclid || '',
          gclid: utm.gclid || '',
        },
        landing: a.landing || ev.landing || '',
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
        // Referrer capturado en cliente (first-touch) tiene prioridad sobre el header
        referrer: a.referrer || referrer,
        device,
      };
    });

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
      bySource,
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
      // Por fuente/origen — visitantes únicos por canal (de dónde viene la gente)
      Event.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $ifNull: [{ $cond: [{ $eq: ['$source', ''] }, null, '$source'] }, 'directo'] },
            eventos: { $sum: 1 },
            visitantes: { $addToSet: { $ifNull: ['$visitorId', '$sessionId'] } },
          },
        },
        { $addFields: { visitantesUnicos: { $size: '$visitantes' } } },
        { $project: { visitantes: 0 } },
        { $sort: { visitantesUnicos: -1 } },
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
      bySource: bySource.map(s => ({ source: s._id, eventos: s.eventos, visitantes: s.visitantesUnicos })),
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

// ─── GET /events/visitors ─── (admin — lista de visitantes con su origen y actividad)
// Agrupa por visitorId persistente (cae a sessionId si el visitante es previo a la cookie).
export const getVisitors = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const sourceFilter = req.query.source || null;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const match = { createdAt: { $gte: since } };
    if (sourceFilter) match.source = sourceFilter;

    const visitors = await Event.aggregate([
      { $match: match },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { $ifNull: [{ $cond: [{ $eq: ['$visitorId', ''] }, null, '$visitorId'] }, '$sessionId'] },
          firstSeen: { $first: '$createdAt' },
          lastSeen: { $last: '$createdAt' },
          source: { $first: '$source' },
          utm: { $first: '$utm' },
          landing: { $first: '$landing' },
          referrer: { $first: '$referrer' },
          device: { $last: '$device' },
          eventos: { $sum: 1 },
          sesiones: { $addToSet: '$sessionId' },
          paginas: { $addToSet: '$page' },
          ultimaPagina: { $last: '$page' },
          ctas: { $sum: { $cond: [{ $eq: ['$type', 'cta'] }, 1, 0] } },
          checkouts: { $sum: { $cond: [{ $eq: ['$action', 'initiate_checkout'] }, 1, 0] } },
        },
      },
      {
        $addFields: {
          numSesiones: { $size: '$sesiones' },
          numPaginas: { $size: '$paginas' },
        },
      },
      { $project: { sesiones: 0, paginas: 0 } },
      { $sort: { lastSeen: -1 } },
      { $limit: limit },
    ]);

    res.json({
      total: visitors.length,
      days,
      visitors: visitors.map(v => ({
        visitorId: v._id,
        source: v.source || 'directo',
        utm: v.utm || {},
        landing: v.landing || '',
        referrer: v.referrer || '',
        device: v.device || 'desktop',
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        eventos: v.eventos,
        sesiones: v.numSesiones,
        paginas: v.numPaginas,
        ultimaPagina: v.ultimaPagina,
        ctas: v.ctas,
        checkouts: v.checkouts,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /events/visitor/:visitorId ─── (admin — recorrido completo de un visitante)
export const getVisitorJourney = async (req, res) => {
  try {
    const id = String(req.params.visitorId || '').trim();
    if (!id) return res.status(400).json({ error: 'visitorId requerido' });
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);

    // Casa por visitorId persistente o, para visitantes antiguos, por sessionId.
    const events = await Event.find({ $or: [{ visitorId: id }, { sessionId: id }] })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    if (!events.length) return res.json({ visitorId: id, eventos: [], resumen: null });

    const first = events[0];
    const last = events[events.length - 1];
    res.json({
      visitorId: id,
      resumen: {
        source: first.source || 'directo',
        utm: first.utm || {},
        landing: first.landing || '',
        referrer: first.referrer || '',
        device: last.device || 'desktop',
        firstSeen: first.createdAt,
        lastSeen: last.createdAt,
        totalEventos: events.length,
        sesiones: [...new Set(events.map(e => e.sessionId))].length,
      },
      eventos: events.map(e => ({
        type: e.type,
        action: e.action,
        label: e.label,
        page: e.page,
        value: e.value,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
