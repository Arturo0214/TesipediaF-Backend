// controllers/statusController.js
// Estado de salud del sistema: servidor (Railway) + Sofia (n8n) + Mongo + Supabase + Cloudinary.
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import cloudinary from '../config/cloudinary.js';
import { getSecuritySnapshot } from '../middleware/securityMonitor.js';

const N8N_URL = (process.env.N8N_BASE_URL || 'https://primary-production-73558.up.railway.app').replace(/\/$/, '');
const N8N_API_KEY = process.env.N8N_API_KEY || '';
// ID del workflow "Tesipedia - Sofia Agent" en n8n (configurable por env)
const SOFIA_WF_ID = process.env.N8N_SOFIA_WORKFLOW_ID || 'IwahEKyHDB76nPLk';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Medianoche de hoy en CDMX expresada en UTC (México ya no tiene DST: UTC-6 fijo).
// Railway corre en UTC — usar new Date().setHours(0,...) cortaría el día 6h antes.
const cdmxMidnightUTC = () => {
  const cdmxDate = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
  return new Date(`${cdmxDate}T06:00:00Z`);
};

// Estados de la conexión de Mongoose
const DB_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

// ─────────────────────────────────────────────────────────────
// Salud del servidor (el propio backend en Railway)
// ─────────────────────────────────────────────────────────────
async function getServerHealth() {
  const uptimeSec = Math.round(process.uptime());
  const startedAt = new Date(Date.now() - uptimeSec * 1000).toISOString();
  const mem = process.memoryUsage();
  const readyState = mongoose.connection?.readyState ?? 0;
  const dbConnected = readyState === 1;

  // Latencia real de Mongo (ping admin)
  let dbPingMs = null;
  if (dbConnected) {
    try {
      const t0 = Date.now();
      await mongoose.connection.db.admin().command({ ping: 1 });
      dbPingMs = Date.now() - t0;
    } catch { /* noop */ }
  }

  return {
    status: dbConnected ? 'up' : 'degraded',
    startedAt,
    uptimeSec,
    nodeEnv: process.env.NODE_ENV || 'development',
    db: {
      status: DB_STATES[readyState] || 'unknown',
      connected: dbConnected,
      host: mongoose.connection?.host || null,
      name: mongoose.connection?.name || null,
      pingMs: dbPingMs,
    },
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Salud de Sofia (n8n)
// ─────────────────────────────────────────────────────────────
async function getSofiaHealth() {
  const out = {
    status: 'down',
    reachable: false,
    instanceUrl: N8N_URL,
    apiConfigured: !!N8N_API_KEY,
    latencyMs: null,
    sofia: null,
  };

  // 1) ¿Responde la instancia de n8n? (endpoint público /healthz)
  try {
    const t0 = Date.now();
    const r = await fetch(`${N8N_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
    out.latencyMs = Date.now() - t0;
    out.reachable = r.ok;
  } catch {
    out.reachable = false;
  }

  // Sin API key sólo podemos reportar alcanzabilidad (modo degradado)
  if (!N8N_API_KEY) {
    out.status = out.reachable ? 'up' : 'down';
    return out;
  }

  const headers = { 'X-N8N-API-KEY': N8N_API_KEY, accept: 'application/json' };
  let sofia = { workflowId: SOFIA_WF_ID };

  // 2) Estado del workflow (activo + nombre)
  try {
    const wr = await fetch(`${N8N_URL}/api/v1/workflows/${SOFIA_WF_ID}`, {
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (wr.ok) {
      const w = await wr.json();
      sofia.name = w.name;
      sofia.active = w.active;
    }
  } catch { /* noop */ }

  // 3) Ejecuciones recientes (éxitos / errores / última / log)
  try {
    const er = await fetch(
      `${N8N_URL}/api/v1/executions?workflowId=${SOFIA_WF_ID}&limit=20&includeData=false`,
      { headers, signal: AbortSignal.timeout(6000) }
    );
    if (er.ok) {
      const data = (await er.json()).data || [];
      const success = data.filter((e) => e.status === 'success').length;
      const error = data.filter((e) => ['error', 'crashed'].includes(e.status)).length;
      const last = data[0] || null;

      sofia.recent = {
        total: data.length,
        success,
        error,
        successRate: data.length ? Math.round((success / data.length) * 100) : null,
      };
      sofia.lastExecution = last
        ? {
            id: last.id,
            status: last.status,
            mode: last.mode,
            startedAt: last.startedAt,
            stoppedAt: last.stoppedAt,
          }
        : null;
      // Log completo para la vista expandible del panel
      sofia.executions = data.map((e) => ({
        id: e.id,
        status: e.status,
        mode: e.mode,
        startedAt: e.startedAt,
        durationMs:
          e.startedAt && e.stoppedAt
            ? new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()
            : null,
      }));
    }
  } catch { /* noop */ }

  out.sofia = sofia;

  // Derivar estado global de Sofia
  if (!out.reachable) {
    out.status = 'down';
  } else if (sofia.active === false || (sofia.recent && sofia.recent.error > 0)) {
    out.status = 'degraded';
  } else {
    out.status = 'up';
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// Datos de negocio en MongoDB (conteos + tamaño)
// ─────────────────────────────────────────────────────────────
async function getMongoStats() {
  if (mongoose.connection?.readyState !== 1) return null;
  try {
    const db = mongoose.connection.db;
    const startOfDay = cdmxMidnightUTC();

    const [stats, users, quotes, quotesToday, projects] = await Promise.all([
      db.stats(),
      db.collection('users').estimatedDocumentCount(),
      db.collection('generatedquotes').estimatedDocumentCount(),
      db.collection('generatedquotes').countDocuments({ createdAt: { $gte: startOfDay } }),
      db.collection('projects').estimatedDocumentCount(),
    ]);

    return {
      dataSizeMB: Math.round((stats.dataSize || 0) / 1024 / 1024),
      storageSizeMB: Math.round((stats.storageSize || 0) / 1024 / 1024),
      collections: stats.collections || null,
      counts: { users, quotes, quotesToday, projects },
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Leads de WhatsApp en Supabase (salud + actividad de Sofia)
// ─────────────────────────────────────────────────────────────
async function getSupabaseStats() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'count=exact',
  };

  // Salud del proyecto: ping al REST API con latencia
  let reachable = false;
  let latencyMs = null;
  try {
    const t0 = Date.now();
    const ping = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_KEY },
      signal: AbortSignal.timeout(5000),
    });
    latencyMs = Date.now() - t0;
    reachable = ping.ok;
  } catch { /* noop */ }
  const count = async (filter = '') => {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?select=wa_id${filter}&limit=1`,
      { headers, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const range = r.headers.get('content-range') || '';
    const total = parseInt(range.split('/')[1], 10);
    return Number.isNaN(total) ? null : total;
  };
  try {
    // created_at/updated_at son timestamp sin tz guardados en UTC
    const iso = cdmxMidnightUTC().toISOString().slice(0, 19);
    const [total, nuevosHoy, actividadHoy, esperando] = await Promise.all([
      count(),
      count(`&created_at=gte.${iso}`),
      count(`&updated_at=gte.${iso}`),
      count('&estado_sofia=eq.esperando_aprobacion'),
    ]);
    return {
      status: reachable ? 'up' : 'down',
      reachable,
      latencyMs,
      leadsTotal: total,
      leadsNuevosHoy: nuevosHoy,
      actividadHoy,
      esperandoAprobacion: esperando,
    };
  } catch {
    return { status: reachable ? 'degraded' : 'down', reachable, latencyMs };
  }
}

// ─────────────────────────────────────────────────────────────
// Salud de Anthropic (API de Claude que usa Sofia) — cache 3 min
// ─────────────────────────────────────────────────────────────
let anthropicCache = { at: 0, data: null };
async function getAnthropicHealth() {
  if (Date.now() - anthropicCache.at < 3 * 60 * 1000) return anthropicCache.data;

  const out = {
    status: 'unknown',
    indicator: null,       // none | minor | major | critical
    description: null,
    incidents: null,
    keyValid: null,
    latencyMs: null,
  };

  // 1) Status público de Anthropic (statuspage.io, sin auth)
  try {
    const r = await fetch('https://status.anthropic.com/api/v2/status.json', {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const s = await r.json();
      out.indicator = s.status?.indicator ?? null;
      out.description = s.status?.description ?? null;
    }
  } catch { /* noop */ }

  // 2) Validar la API key sin gastar tokens (GET /v1/models)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const t0 = Date.now();
      const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(6000),
      });
      out.latencyMs = Date.now() - t0;
      out.keyValid = r.ok;
    } catch { /* noop */ }
  }

  // Derivar estado: incidentes mayores o key inválida → problema
  if (out.indicator === 'none' && out.keyValid !== false) out.status = 'up';
  else if (out.indicator === 'critical' || out.indicator === 'major' || out.keyValid === false) out.status = 'down';
  else if (out.indicator === 'minor') out.status = 'degraded';
  else if (out.indicator == null && out.keyValid == null) out.status = 'unknown';
  else out.status = out.keyValid ? 'up' : 'unknown';

  anthropicCache = { at: Date.now(), data: out };
  return out;
}

// ─────────────────────────────────────────────────────────────
// Uso de Cloudinary (créditos / storage / bandwidth) — cache 5 min
// para no quemar el rate limit del Admin API (500 req/h)
// ─────────────────────────────────────────────────────────────
let cloudinaryCache = { at: 0, data: null };
async function getCloudinaryUsage() {
  if (Date.now() - cloudinaryCache.at < 5 * 60 * 1000) return cloudinaryCache.data;
  try {
    const u = await cloudinary.api.usage();
    const data = {
      plan: u.plan || null,
      credits: u.credits
        ? {
            usage: Math.round(u.credits.usage * 100) / 100,
            limit: u.credits.limit,
            usedPercent: Math.round(u.credits.used_percent * 10) / 10,
          }
        : null,
      storageGB: u.storage?.usage ? Math.round((u.storage.usage / 1073741824) * 100) / 100 : null,
      bandwidthGB: u.bandwidth?.usage ? Math.round((u.bandwidth.usage / 1073741824) * 100) / 100 : null,
      transformations: u.transformations?.usage ?? null,
    };
    cloudinaryCache = { at: Date.now(), data };
    return data;
  } catch {
    return cloudinaryCache.data; // si falla, devolver lo último conocido
  }
}

// @desc    Estado de salud agregado del sistema
// @route   GET /status
// @access  Admin
export const getSystemStatus = asyncHandler(async (req, res) => {
  const [server, n8n, mongo, supabase, cloudinaryUsage, anthropic, security] = await Promise.all([
    getServerHealth(),
    getSofiaHealth(),
    getMongoStats(),
    getSupabaseStats(),
    getCloudinaryUsage(),
    getAnthropicHealth(),
    getSecuritySnapshot().catch(() => null),
  ]);

  // Supabase caído, Anthropic con incidentes o actividad sospechosa degradan
  // el estado global (solo server/n8n lo marcan como caído)
  const degradedDeps =
    supabase?.status === 'down' || anthropic?.status === 'down' || anthropic?.status === 'degraded' ||
    (security && security.status !== 'up');

  const overall =
    server.status === 'down' || n8n.status === 'down'
      ? 'down'
      : server.status === 'up' && n8n.status === 'up' && !degradedDeps
      ? 'up'
      : 'degraded';

  res.json({
    overall,
    timestamp: new Date().toISOString(),
    server,
    n8n,
    mongo,
    supabase,
    anthropic,
    cloudinary: cloudinaryUsage,
    security,
  });
});
