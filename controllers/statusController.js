// controllers/statusController.js
// Estado de salud del sistema: servidor (Railway) + Sofia (n8n).
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

const N8N_URL = (process.env.N8N_BASE_URL || 'https://primary-production-73558.up.railway.app').replace(/\/$/, '');
const N8N_API_KEY = process.env.N8N_API_KEY || '';
// ID del workflow "Tesipedia - Sofia Agent" en n8n (configurable por env)
const SOFIA_WF_ID = process.env.N8N_SOFIA_WORKFLOW_ID || 'IwahEKyHDB76nPLk';

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
function getServerHealth() {
  const uptimeSec = Math.round(process.uptime());
  const startedAt = new Date(Date.now() - uptimeSec * 1000).toISOString();
  const mem = process.memoryUsage();
  const readyState = mongoose.connection?.readyState ?? 0;
  const dbConnected = readyState === 1;

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
    sofia: null,
  };

  // 1) ¿Responde la instancia de n8n? (endpoint público /healthz)
  try {
    const r = await fetch(`${N8N_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
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

  // 3) Ejecuciones recientes (éxitos / errores / última)
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

// @desc    Estado de salud agregado del sistema
// @route   GET /status
// @access  Admin
export const getSystemStatus = asyncHandler(async (req, res) => {
  const server = getServerHealth();
  const n8n = await getSofiaHealth();

  const overall =
    server.status === 'up' && n8n.status === 'up'
      ? 'up'
      : server.status === 'down' || n8n.status === 'down'
      ? 'down'
      : 'degraded';

  res.json({
    overall,
    timestamp: new Date().toISOString(),
    server,
    n8n,
  });
});
