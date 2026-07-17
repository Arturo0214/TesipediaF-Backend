// controllers/loopsController.js
// Panel de métricas de loops: mide como ciclos los datos que ya existen.
//  - Precios / elasticidad: tasa de cierre por segmento (Mongo: GeneratedQuote × Project)
//  - Reactivación: % de leads revividos que convierten + revenue recuperado (Supabase RPC + Mongo)
//  - Inteligencia conversacional: objeciones minadas de las conversaciones (Supabase RPC)
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Cache 5 min: las agregaciones recorren miles de cotizaciones y 4.7k historiales
let cache = { at: 0, data: null };
const CACHE_MS = 5 * 60 * 1000;

const rpc = async (fn) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`RPC ${fn} → ${r.status}`);
  return r.json();
};

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// ── Loop de precios / elasticidad (Mongo) ─────────────────────
async function getPreciosLoop() {
  const db = mongoose.connection.db;
  const gq = db.collection('generatedquotes');
  const projects = db.collection('projects');

  // Señal de cierre: cotización con Project vinculado, o status paid/approved
  const projQuoteIds = (await projects.distinct('generatedQuote', { generatedQuote: { $ne: null } }))
    .map((id) => id?.toString())
    .filter(Boolean);
  const convertedSet = new Set(projQuoteIds);

  const docs = await gq.find(
    {},
    { projection: { carrera: 1, tipoTrabajo: 1, area: 1, extensionEstimada: 1, recargoPorcentaje: 1, precioConDescuento: 1, status: 1 } }
  ).toArray();

  const isConverted = (d) =>
    convertedSet.has(d._id.toString()) || d.status === 'paid' || d.status === 'approved';

  const bucketByKey = (keyFn) => {
    const map = new Map();
    for (const d of docs) {
      const key = keyFn(d);
      if (!key) continue;
      const b = map.get(key) || { segmento: key, total: 0, cerradas: 0, ticketSum: 0 };
      b.total++;
      if (isConverted(d)) {
        b.cerradas++;
        b.ticketSum += Number(d.precioConDescuento) || 0;
      }
      map.set(key, b);
    }
    return [...map.values()]
      .map((b) => ({
        segmento: b.segmento,
        total: b.total,
        cerradas: b.cerradas,
        tasaCierre: b.total ? Math.round((b.cerradas / b.total) * 1000) / 10 : 0,
        ticketPromedio: b.cerradas ? Math.round(b.ticketSum / b.cerradas) : null,
      }))
      .filter((b) => b.total >= 5) // segmentos con muestra suficiente
      .sort((a, b) => b.total - a.total);
  };

  const totalQuotes = docs.length;
  const totalCerradas = docs.filter(isConverted).length;
  const tasaGlobal = totalQuotes ? Math.round((totalCerradas / totalQuotes) * 1000) / 10 : 0;

  const porCarrera = bucketByKey((d) => d.carrera).slice(0, 12);
  const porTipo = bucketByKey((d) => d.tipoTrabajo).slice(0, 8);

  // Recomendación de elasticidad: segmentos con cierre muy por encima de la
  // media → margen para subir precio; muy por debajo → probablemente caro.
  const recomendaciones = porCarrera
    .filter((s) => s.total >= 10)
    .map((s) => {
      let señal = 'ok';
      if (s.tasaCierre >= tasaGlobal * 1.6) señal = 'subir_precio';
      else if (s.tasaCierre > 0 && s.tasaCierre <= tasaGlobal * 0.5) señal = 'revisar_precio';
      return { ...s, señal };
    })
    .filter((s) => s.señal !== 'ok');

  return {
    totalQuotes,
    totalCerradas,
    tasaGlobal,
    porCarrera,
    porTipo,
    recomendaciones,
  };
}

// ── Loop de reactivación (Supabase RPC + Mongo para revenue) ──
async function getReactivacionLoop() {
  const stats = await rpc('loop_reactivacion_stats');
  const s = Array.isArray(stats) ? stats[0] : stats;

  // Revenue real recuperado: cruzar los wa_id revividos-convertidos con pagos
  // en Mongo por teléfono (el campo precio de Supabase viene vacío en pagados).
  let revenueRecuperado = 0;
  const waIds = s?.revividosConvertidosWaIds || [];
  if (waIds.length) {
    const phones = waIds.map(last10).filter((p) => p.length === 10);
    if (phones.length) {
      const db = mongoose.connection.db;
      const orPhone = phones.map((p) => new RegExp(`${p}$`));
      const [pays, quotes] = await Promise.all([
        db.collection('payments')
          .find({ status: 'completed', clientPhone: { $in: orPhone } }, { projection: { amount: 1, clientPhone: 1 } })
          .toArray(),
        db.collection('generatedquotes')
          .find({ status: 'paid', clientPhone: { $in: orPhone } }, { projection: { precioConDescuento: 1, clientPhone: 1 } })
          .toArray(),
      ]);
      const seen = new Set();
      for (const p of pays) {
        const k = last10(p.clientPhone);
        if (seen.has(k)) continue;
        seen.add(k);
        revenueRecuperado += Number(p.amount) || 0;
      }
      // completar con cotizaciones pagadas de teléfonos aún no contabilizados
      for (const q of quotes) {
        const k = last10(q.clientPhone);
        if (seen.has(k)) continue;
        seen.add(k);
        revenueRecuperado += Number(q.precioConDescuento) || 0;
      }
    }
  }

  return {
    leadsTotal: s?.leadsTotal ?? null,
    descartados: s?.descartados ?? null,
    conRevival: s?.conRevival ?? null,
    revividosConvertidos: s?.revividosConvertidos ?? null,
    tasaRevival: s?.tasaRevival ?? null,
    pagadosTotal: s?.pagadosTotal ?? null,
    revenueRecuperado: Math.round(revenueRecuperado),
  };
}

// ── Loop de inteligencia conversacional (Supabase RPC) ────────
async function getObjecionesLoop() {
  const stats = await rpc('loop_objeciones_stats');
  const s = Array.isArray(stats) ? stats[0] : stats;
  return {
    totalMsgsUsuario: s?.totalMsgsUsuario ?? null,
    leadsConObjecion: s?.leadsConObjecion ?? null,
    categorias: s?.categorias || [],
  };
}

// @desc    Métricas agregadas de los loops de negocio
// @route   GET /loops
// @access  Admin
export const getLoopMetrics = asyncHandler(async (req, res) => {
  if (!req.query.fresh && Date.now() - cache.at < CACHE_MS && cache.data) {
    return res.json({ ...cache.data, cached: true });
  }

  const [precios, reactivacion, objeciones] = await Promise.all([
    getPreciosLoop().catch((e) => ({ error: e.message })),
    getReactivacionLoop().catch((e) => ({ error: e.message })),
    getObjecionesLoop().catch((e) => ({ error: e.message })),
  ]);

  const payload = {
    timestamp: new Date().toISOString(),
    precios,
    reactivacion,
    objeciones,
    cached: false,
  };
  cache = { at: Date.now(), data: payload };
  res.json(payload);
});
