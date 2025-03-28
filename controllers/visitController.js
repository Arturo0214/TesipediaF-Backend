import asyncHandler from 'express-async-handler';
import Visit from '../models/Visit.js';
import getGeoFromIP from '../utils/geoLookup.js';
import Notification from '../models/Notification.js';

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;

export const trackVisit = asyncHandler(async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.get('User-Agent');
  const path = req.body.path || req.originalUrl;

  const cookieId = req.cookies?.cookieId || null;
  const geo = await getGeoFromIP(ip);

  await Visit.create({
    ip,
    userAgent,
    path,
    cookieId,
    city: geo?.city,
    region: geo?.region,
    country: geo?.country,
    org: geo?.org,
    location: geo?.loc,
  });

  await Notification.create({
    user: SUPER_ADMIN_ID,
    type: 'visita',
    message: '🧭 Nueva visita registrada en el sitio',
    data: {
      ip: req.clientIp || ip || '',
      country: geo?.country || '',
      city: geo?.city || '',
    },
  });

  res.status(200).json({ message: 'Visita registrada con geolocalización' });
});

// 📋 Obtener todas las visitas (admin)
export const getVisits = asyncHandler(async (req, res) => {
  const visits = await Visit.find({}).sort({ createdAt: -1 });
  res.json(visits);
});

// 🔍 Obtener visita por ID (admin)
export const getVisitById = asyncHandler(async (req, res) => {
  const visit = await Visit.findById(req.params.id);

  if (visit) {
    res.json(visit);
  } else {
    res.status(404);
    throw new Error('Visita no encontrada');
  }
});

// 🔄 Actualizar visita (admin)
export const updateVisit = asyncHandler(async (req, res) => {
  const visit = await Visit.findById(req.params.id);

  if (visit) {
    visit.path = req.body.path || visit.path;
    visit.city = req.body.city || visit.city;
    visit.region = req.body.region || visit.region;
    visit.country = req.body.country || visit.country;
    visit.org = req.body.org || visit.org;
    visit.location = req.body.location || visit.location;

    const updatedVisit = await visit.save();
    res.json(updatedVisit);
  } else {
    res.status(404);
    throw new Error('Visita no encontrada');
  }
});

// ❌ Eliminar visita (admin)
export const deleteVisit = asyncHandler(async (req, res) => {
  const visit = await Visit.findById(req.params.id);

  if (visit) {
    await visit.deleteOne();
    res.json({ message: 'Visita eliminada correctamente' });
  } else {
    res.status(404);
    throw new Error('Visita no encontrada');
  }
});

export const getVisitStats = asyncHandler(async (req, res) => {
  const total = await Visit.countDocuments();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayCount = await Visit.countDocuments({ createdAt: { $gte: today } });

  res.json({
    totalVisits: total,
    visitsToday: todayCount,
    });
});

export const getVisitHistory = asyncHandler(async (req, res) => {
  const visits = await Visit.find().sort({ createdAt: -1 });
  res.json(visits);
});

export const getVisitAnalytics = asyncHandler(async (req, res) => {
  const analytics = await Visit.aggregate([
    {
      $group: {
        _id: '$country',
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  res.json(analytics);
});
