/**
 * n8n Watchdog Cron — vigila que el Worker de n8n (bot Sofia) siga vivo.
 *
 * Contexto: el Worker corre en Railway con restartPolicy ON_FAILURE tope 10.
 * Si entra en crash-loop agota los 10 reintentos y Railway se rinde → el Worker
 * queda MUERTO y Sofia deja de responder hasta que alguien lo reinicia a mano
 * (pasó el 2026-07-02: 16h caído sin que nadie se enterara).
 *
 * Este watchdog corre en el Backend (Render), independiente de Railway, y cada
 * pocos minutos:
 *   1. Consulta el estado del deployment del Worker vía API de Railway.
 *   2. Si está CRASHED/FAILED → lo reinicia solo (deploymentRestart) y avisa por WhatsApp.
 * Con throttle para no reiniciar/avisar en bucle.
 *
 * Requiere en el entorno (Render):
 *   RAILWAY_API_TOKEN        — token de cuenta de Railway (obligatorio; si falta, se desactiva)
 *   WA_PHONE_ID / WA_TOKEN   — ya existen, para la alerta de WhatsApp
 * Opcionales (tienen default a los IDs del proyecto de Sofia):
 *   N8N_WATCHDOG_PROJECT_ID, N8N_WATCHDOG_ENV_ID, N8N_WATCHDOG_SERVICE_ID
 *   N8N_WATCHDOG_ALERT_WA    — número que recibe la alerta (default: admin principal)
 *   N8N_WATCHDOG_DISABLED    — 'true' para apagarlo
 */
import cron from 'node-cron';

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';
const RAILWAY_TOKEN = process.env.RAILWAY_API_TOKEN;

// IDs del proyecto n8n de Sofia (humble-surprise / Worker). No son secretos.
const PROJECT_ID = process.env.N8N_WATCHDOG_PROJECT_ID || '24022dae-9d2d-4a90-96b6-d19835b843f0';
const ENV_ID = process.env.N8N_WATCHDOG_ENV_ID || '0787824f-0a96-4429-a421-4ee27ae7b6e9';
const SERVICE_ID = process.env.N8N_WATCHDOG_SERVICE_ID || '047279ec-9e61-4838-b291-223575feb1fe';

const ALERT_WA = process.env.N8N_WATCHDOG_ALERT_WA || '5215583352096';
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const WA_TOKEN = process.env.WA_TOKEN;

// Estados sanos de un deployment de Railway; cualquier otro dispara acción.
const HEALTHY = ['SUCCESS', 'BUILDING', 'DEPLOYING', 'INITIALIZING', 'WAITING', 'QUEUED', 'SKIPPED'];
// No re-actuar más seguido que esto (evita bucles de reinicio).
const ACTION_COOLDOWN_MS = 10 * 60 * 1000;

let lastActionAt = 0;
let lastStatus = null;

async function railwayQuery(query, variables) {
  const r = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RAILWAY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await r.json();
  if (data.errors) throw new Error(data.errors.map(e => e.message).join('; '));
  return data.data;
}

async function getWorkerDeployment() {
  const q = `query($p: String!, $e: String!, $s: String!) {
    deployments(first: 1, input: { projectId: $p, environmentId: $e, serviceId: $s }) {
      edges { node { id status } }
    }
  }`;
  const d = await railwayQuery(q, { p: PROJECT_ID, e: ENV_ID, s: SERVICE_ID });
  const node = d?.deployments?.edges?.[0]?.node;
  return node || null;
}

async function restartDeployment(deploymentId) {
  const q = `mutation($id: String!) { deploymentRestart(id: $id) }`;
  const d = await railwayQuery(q, { id: deploymentId });
  return d?.deploymentRestart === true;
}

async function sendWhatsAppAlert(message) {
  if (!WA_PHONE_ID || !WA_TOKEN || !ALERT_WA) return;
  try {
    await fetch(`https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: ALERT_WA.replace(/\D/g, ''),
        type: 'text',
        text: { body: message },
      }),
    });
  } catch (err) {
    console.warn('[n8nWatchdog] Falló el envío de alerta WhatsApp:', err.message);
  }
}

async function runWatchdog() {
  if (!RAILWAY_TOKEN) return; // desactivado silenciosamente si no hay token
  try {
    const dep = await getWorkerDeployment();
    if (!dep) { console.warn('[n8nWatchdog] No se pudo leer el deployment del Worker'); return; }

    const healthy = HEALTHY.includes(dep.status);
    if (dep.status !== lastStatus) {
      console.log(`[n8nWatchdog] Worker de Sofia: ${dep.status}${healthy ? '' : ' ⚠️'}`);
      lastStatus = dep.status;
    }
    if (healthy) return;

    // No sano (CRASHED/FAILED/REMOVED…). Actuar con cooldown.
    const now = Date.now();
    if (now - lastActionAt < ACTION_COOLDOWN_MS) {
      console.warn(`[n8nWatchdog] Worker ${dep.status} pero en cooldown, no re-actúo aún.`);
      return;
    }
    lastActionAt = now;

    console.error(`[n8nWatchdog] 🔴 Worker de Sofia en ${dep.status} — reiniciando…`);
    let ok = false;
    try { ok = await restartDeployment(dep.id); }
    catch (err) { console.error('[n8nWatchdog] Error al reiniciar:', err.message); }

    const stamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    await sendWhatsAppAlert(
      `🔴 SOFIA CAÍDA — El Worker de n8n estaba "${dep.status}" (${stamp}).\n` +
      (ok
        ? `✅ Lo reinicié automáticamente. Debería volver a responder en 1-2 min. Revisa que se recupere.`
        : `⚠️ NO pude reiniciarlo por API. Entra a Railway (humble-surprise → Worker → Restart) YA.`)
    );
    console.log(`[n8nWatchdog] Acción tomada. Reinicio ${ok ? 'OK' : 'FALLÓ'}, alerta enviada a ${ALERT_WA}.`);
  } catch (err) {
    console.warn('[n8nWatchdog] Error en la revisión:', err.message);
  }
}

export function startN8nWatchdogCron() {
  if (process.env.N8N_WATCHDOG_DISABLED === 'true') {
    console.log('[n8nWatchdog] Desactivado por N8N_WATCHDOG_DISABLED.');
    return;
  }
  if (!RAILWAY_TOKEN) {
    console.warn('[n8nWatchdog] ⚠️ Sin RAILWAY_API_TOKEN — el watchdog NO vigilará a Sofia. Agrégalo en Render para activarlo.');
    return;
  }
  // Cada 3 minutos.
  cron.schedule('*/3 * * * *', runWatchdog);
  console.log(`[n8nWatchdog] Vigilancia del Worker de Sofia iniciada (cada 3 min). Alertas a ${ALERT_WA}.`);
}

export { runWatchdog };
