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
