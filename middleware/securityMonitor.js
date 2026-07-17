// middleware/securityMonitor.js
// Monitor de seguridad: detecta comportamiento sospechoso (fuerza bruta en login,
// sondeo de vulnerabilidades, intentos de inyección, ráfagas anómalas), bloquea
// IPs ofensoras temporalmente y persiste los eventos en Mongo para el panel admin.
import mongoose from 'mongoose';

// ── Umbrales ──────────────────────────────────────────────────
const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000;  // ventana para contar logins fallidos
const FAILED_LOGIN_MAX = 8;                     // fallos en ventana → bloqueo
const RATE_WINDOW_MS = 60 * 1000;               // ventana de ráfaga
const RATE_MAX = 250;                           // req/min por IP → bloqueo (generalLimiter ya corta a 100 por ruta)
const BLOCK_MS = 15 * 60 * 1000;                // duración del bloqueo
const EVENT_BUFFER_MAX = 300;                   // eventos recientes en memoria

// Rutas que solo tocan scanners de vulnerabilidades, jamás la app real
const PROBE_RE = /\.(env|git|htaccess|htpasswd|aws|ssh|bak|sql|yml)($|\/)|wp-(admin|login|content|includes)|phpmyadmin|xmlrpc|\.php($|\?)|\/etc\/passwd|\/actuator|\/cgi-bin|\/vendor\/phpunit|\/boaform|\/HNAP1/i;

// Firmas de inyección NoSQL / SQL / XSS / path traversal en URL o query
const INJECTION_RE = /\$(ne|gt|gte|lt|lte|where|regex|expr)\b|union[\s+]+select|<script|javascript:|\.\.\/\.\.\/|\/etc\/passwd|sleep\s*\(\d/i;

// ── Estado en memoria ─────────────────────────────────────────
const ipRate = new Map();        // ip → { count, windowStart }
const failedLogins = new Map();  // ip → [timestamps]
const blocked = new Map();       // ip → untilTs
const recentEvents = [];         // ring buffer

// Esquema laxo para eventos, con TTL de 7 días
const securityEventSchema = new mongoose.Schema(
  {
    type: String,      // brute_force | probe | injection | rate_spike | blocked_hit | failed_login
    severity: String,  // info | warning | critical
    ip: String,
    path: String,
    detail: String,
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 },
  },
  { collection: 'securityevents', versionKey: false }
);
const SecurityEvent =
  mongoose.models.SecurityEvent || mongoose.model('SecurityEvent', securityEventSchema);

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';

const isLocal = (ip) => ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.');

function recordEvent(type, severity, ip, path, detail) {
  const ev = { type, severity, ip, path: (path || '').slice(0, 200), detail, at: new Date().toISOString() };
  recentEvents.push(ev);
  if (recentEvents.length > EVENT_BUFFER_MAX) recentEvents.shift();
  // Persistir solo warning/critical (los info generarían demasiado ruido en BD)
  if (severity !== 'info' && mongoose.connection?.readyState === 1) {
    SecurityEvent.create({ type, severity, ip, path: ev.path, detail }).catch(() => {});
  }
}

function blockIp(ip, reason, path) {
  if (blocked.has(ip)) return;
  blocked.set(ip, Date.now() + BLOCK_MS);
  recordEvent(reason, 'critical', ip, path, `IP bloqueada ${BLOCK_MS / 60000} min por ${reason}`);
}

// ── Middleware principal (montar temprano en server.js) ───────
export const securityMonitor = (req, res, next) => {
  const ip = clientIp(req);
  if (isLocal(ip)) return next();

  const now = Date.now();

  // 0) IP bloqueada → cortar de inmediato
  const until = blocked.get(ip);
  if (until) {
    if (now < until) {
      recordEvent('blocked_hit', 'info', ip, req.path, 'Petición de IP bloqueada rechazada');
      return res.status(429).json({ message: 'Demasiadas peticiones. Intenta más tarde.' });
    }
    blocked.delete(ip);
  }

  // 1) Ráfaga anómala por IP
  const rate = ipRate.get(ip);
  if (!rate || now - rate.windowStart > RATE_WINDOW_MS) {
    ipRate.set(ip, { count: 1, windowStart: now });
  } else {
    rate.count++;
    if (rate.count === RATE_MAX) {
      blockIp(ip, 'rate_spike', req.path);
      return res.status(429).json({ message: 'Demasiadas peticiones. Intenta más tarde.' });
    }
  }

  // 2) Sondeo de vulnerabilidades (scanners buscando .env, wp-admin, etc.)
  if (PROBE_RE.test(req.path)) {
    recordEvent('probe', 'warning', ip, req.path, 'Ruta típica de scanner de vulnerabilidades');
    blockIp(ip, 'probe', req.path);
    return res.status(404).end();
  }

  // 3) Firmas de inyección en URL / query string
  const rawUrl = decodeURIComponent(req.originalUrl || req.url || '');
  if (INJECTION_RE.test(rawUrl)) {
    recordEvent('injection', 'warning', ip, req.path, `Patrón de inyección en URL: ${rawUrl.slice(0, 120)}`);
    return res.status(400).json({ message: 'Petición inválida' });
  }

  // 4) Fuerza bruta en login: observar 401 de POST /users/login y /auth/*
  const isAuthRoute = req.method === 'POST' && (/^\/(users\/login|auth\/login|users\/reset-password)/.test(req.path));
  if (isAuthRoute) {
    res.on('finish', () => {
      if (res.statusCode !== 401 && res.statusCode !== 400) return;
      const arr = failedLogins.get(ip) || [];
      const fresh = arr.filter((t) => now - t < FAILED_LOGIN_WINDOW_MS);
      fresh.push(now);
      failedLogins.set(ip, fresh);
      recordEvent('failed_login', 'info', ip, req.path, `Login fallido (${fresh.length} en ${FAILED_LOGIN_WINDOW_MS / 60000} min)`);
      if (fresh.length >= FAILED_LOGIN_MAX) {
        blockIp(ip, 'brute_force', req.path);
        failedLogins.delete(ip);
      }
    });
  }

  next();
};

// ── Snapshot para el endpoint /status ─────────────────────────
export async function getSecuritySnapshot() {
  const now = Date.now();

  // Limpiar bloqueos expirados
  for (const [ip, until] of blocked) if (now >= until) blocked.delete(ip);

  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  let dbStats = null;
  try {
    if (mongoose.connection?.readyState === 1) {
      const agg = await SecurityEvent.aggregate([
        { $match: { createdAt: { $gte: last24h } } },
        { $group: { _id: { type: '$type', severity: '$severity' }, n: { $sum: 1 } } },
      ]);
      dbStats = {};
      for (const r of agg) dbStats[r._id.type] = (dbStats[r._id.type] || 0) + r.n;
    }
  } catch { /* noop */ }

  const eventsRecent = recentEvents.slice(-30).reverse();
  const criticalLast10m = recentEvents.filter(
    (e) => e.severity === 'critical' && now - new Date(e.at).getTime() < 10 * 60 * 1000
  ).length;
  const warningsLastHour = recentEvents.filter(
    (e) => e.severity !== 'info' && now - new Date(e.at).getTime() < 60 * 60 * 1000
  ).length;

  // Derivar estado: ataque activo > actividad sospechosa > limpio
  const status =
    criticalLast10m > 0 || blocked.size > 0 ? 'down'
    : warningsLastHour > 0 ? 'degraded'
    : 'up';

  // Logins fallidos acumulados en ventana (por si hay intentos en curso sin bloqueo)
  let failedLoginAttempts = 0;
  for (const arr of failedLogins.values())
    failedLoginAttempts += arr.filter((t) => now - t < FAILED_LOGIN_WINDOW_MS).length;

  return {
    status, // up = sin amenazas | degraded = actividad sospechosa | down = bajo ataque / bloqueos activos
    blockedIps: [...blocked.keys()],
    failedLoginAttempts,
    eventos24h: dbStats, // { brute_force, probe, injection, rate_spike, ... } persistidos
    eventsRecent,
  };
}
