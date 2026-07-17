import asyncHandler from 'express-async-handler';
import ContentPiece from '../models/ContentPiece.js';
import Competitor from '../models/Competitor.js';
import { publishToMeta } from './socialController.js';

const IG_ID = '17841477846360365';
const PAGE_ID = '855962324262046';

// Cache en memoria del escaneo (Business Discovery tiene rate limits)
let SCAN_CACHE = null;
const SCAN_TTL = 6 * 60 * 60 * 1000; // 6 horas

// Watchlist inicial (verificada contra Business Discovery jul-2026)
const DEFAULT_COMPETITORS = [
    'tutesis.oficial', 'mayrabadajoz', 'mister_investigacion',
    'carlossolanotesis', 'tesisymasters.argentina', 'tesisymasters.mexico',
    'especialistasentesis', 'tesistime_', 'tutesis_', 'tesiscoachoficial',
    'alejandria_consultoria',
];

async function getPageToken() {
    const userToken = process.env.META_ACCESS_TOKEN;
    if (!userToken) return null;
    try {
        const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`);
        const data = await res.json();
        return data.data?.find(p => p.id === PAGE_ID)?.access_token || null;
    } catch { return null; }
}

// ════════════════════════════════════════
// Board de Contenido — CRUD
// ════════════════════════════════════════
export const listContent = asyncHandler(async (req, res) => {
    const items = await ContentPiece.find().sort({ createdAt: -1 }).limit(300);
    res.json({ success: true, data: items });
});

export const createContent = asyncHandler(async (req, res) => {
    const item = await ContentPiece.create(req.body);
    res.status(201).json({ success: true, data: item });
});

// Migración one-shot desde localStorage: recibe un array de piezas
export const importContent = asyncHandler(async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
        return res.json({ success: true, imported: 0 });
    }
    const docs = items.slice(0, 200).map(({ id, createdAt, ...rest }) => ({
        ...rest,
        source: rest.source || 'manual',
    }));
    const created = await ContentPiece.insertMany(docs, { ordered: false });
    res.json({ success: true, imported: created.length });
});

export const updateContent = asyncHandler(async (req, res) => {
    const item = await ContentPiece.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) { res.status(404); throw new Error('Pieza no encontrada'); }
    res.json({ success: true, data: item });
});

export const deleteContent = asyncHandler(async (req, res) => {
    const item = await ContentPiece.findByIdAndDelete(req.params.id);
    if (!item) { res.status(404); throw new Error('Pieza no encontrada'); }
    res.json({ success: true });
});

// ════════════════════════════════════════
// Auto-publicación (IG/FB) — publicar ahora, agendar, y scheduler
// ════════════════════════════════════════

// Publica una pieza del board a su plataforma. Actualiza estado/resultado.
async function publishPiece(piece) {
    // Mensaje = caption + hashtags
    const parts = [piece.caption, piece.hashtags].map((s) => (s || '').trim()).filter(Boolean);
    const message = parts.join('\n\n');
    const result = await publishToMeta({
        platform: piece.platform,
        message,
        imageUrl: piece.imageUrl,
        mediaUrls: piece.mediaUrls,
        videoUrl: piece.videoUrl,
    });

    piece.publishResult = {
        ok: result.ok,
        postId: result.postId || '',
        permalink: result.permalink || '',
        error: result.error || '',
        at: new Date(),
    };
    if (result.ok) {
        piece.status = 'published';
        piece.publishedAt = new Date();
        piece.autoPublish = false; // ya se publicó, no repetir
    }
    await piece.save();
    return result;
}

// POST /social/content/:id/publish — publicar una pieza ahora
export const publishContentNow = asyncHandler(async (req, res) => {
    const piece = await ContentPiece.findById(req.params.id);
    if (!piece) { res.status(404); throw new Error('Pieza no encontrada'); }
    if (!piece.imageUrl && piece.platform === 'instagram') {
        res.status(400); throw new Error('Instagram requiere una imagen en la pieza');
    }
    const result = await publishPiece(piece);
    if (!result.ok) { res.status(502); throw new Error(result.error || 'Error al publicar'); }
    res.json({ success: true, data: piece });
});

// PATCH /social/content/:id/schedule — agendar (o cancelar) auto-publicación
export const scheduleContent = asyncHandler(async (req, res) => {
    const { scheduledFor, autoPublish } = req.body;
    const piece = await ContentPiece.findById(req.params.id);
    if (!piece) { res.status(404); throw new Error('Pieza no encontrada'); }
    if (scheduledFor !== undefined) piece.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;
    if (autoPublish !== undefined) piece.autoPublish = !!autoPublish;
    if (piece.autoPublish && piece.status === 'published') piece.status = 'ready'; // re-agendar
    await piece.save();
    res.json({ success: true, data: piece });
});

// ════════════════════════════════════════
// POST /social/content/suggest — Claude propone piezas de contenido
// para que siempre haya cola (flujo constante). source='agent', status='idea'.
// ════════════════════════════════════════
// Núcleo reutilizable: genera N piezas con Claude y las inserta como 'idea'/'agent'.
async function generateSuggestions(count) {
    const TOKEN = process.env.ANTHROPIC_API_KEY;
    if (!TOKEN) throw new Error('ANTHROPIC_API_KEY no configurada');

    // Contexto de competencia: watchlist + top posts cacheados si existen
    let competencia = DEFAULT_COMPETITORS.slice(0, 8);
    try {
        const comps = await Competitor.find().limit(15);
        if (comps.length) competencia = comps.map(c => c.username).slice(0, 10);
    } catch { /* noop */ }
    let topPosts = [];
    if (SCAN_CACHE?.data) {
        for (const c of SCAN_CACHE.data.slice(0, 6)) {
            if (c.topPost?.caption) topPosts.push(`@${c.username} (${c.topPost.likes || 0} likes): ${String(c.topPost.caption).slice(0, 120)}`);
        }
    }

    const system = `Eres el estratega de contenido de redes de Tesipedia, servicio mexicano de elaboración y asesoría de tesis (Instagram @tesipediaoficial, Facebook y a futuro TikTok). Tu público: estudiantes de licenciatura, maestría y doctorado en México que necesitan hacer/terminar su tesis, con objeciones típicas de precio, presupuesto, desconfianza y tiempo.

Propones contenido que EDUCA y GENERA CONFIANZA (no venta agresiva): tips de metodología, estructura de tesis, errores comunes, mitos, testimonios, detrás de cámaras, y CTAs suaves a cotizar por WhatsApp. Tono cálido, cercano, mexicano, con emojis moderados. Nada de markdown.

Formatos: 'reel' (video corto con hook), 'carousel' (varias imágenes educativas), 'post' (imagen única), 'story'. Balancea los tipos.

Devuelve SOLO un JSON array de ${count} piezas, cada una:
{"platform":"instagram|facebook","type":"reel|carousel|post|story","caption":"copy listo para publicar con CTA suave","hashtags":"8-12 hashtags relevantes de nicho (tesis, titulación, carreras, México)","imagePrompt":"descripción para generar la imagen/portada","reelIdea":"si es reel: guion/hook de 2-3 líneas; si no, vacío","notes":"por qué funciona / a qué objeción o etapa apunta"}`;

    const userMsg = `Genera ${count} piezas variadas de contenido para las próximas semanas (flujo constante).
Competencia que lo hace bien: ${competencia.join(', ')}.
${topPosts.length ? 'Posts ganadores recientes de la competencia:\n' + topPosts.join('\n') : ''}
Devuelve el JSON array.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': TOKEN, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 6000, system, messages: [{ role: 'user', content: userMsg }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Claude: ' + (j.error?.message || 'error'));
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    let ideas;
    const mm = text.match(/\[[\s\S]*\]/);
    ideas = JSON.parse(mm ? mm[0] : text);
    if (!Array.isArray(ideas)) ideas = [ideas];

    const docs = ideas.slice(0, count).map(x => ({
        platform: ['instagram', 'facebook', 'tiktok'].includes(x.platform) ? x.platform : 'instagram',
        type: ['reel', 'carousel', 'post', 'story', 'text'].includes(x.type) ? x.type : 'post',
        caption: x.caption || '',
        hashtags: x.hashtags || '',
        imagePrompt: x.imagePrompt || '',
        reelIdea: x.reelIdea || '',
        notes: x.notes || '',
        status: 'idea',
        source: 'agent',
    }));
    const created = await ContentPiece.insertMany(docs);
    return { created, usage: j.usage };
}

export const suggestContent = asyncHandler(async (req, res) => {
    const count = Math.min(Math.max(parseInt(req.body.count, 10) || 6, 1), 12);
    const { created, usage } = await generateSuggestions(count);
    res.json({ success: true, creadas: created.length, data: created, usage });
});

// ── Cadencia automática: mantiene la cola llena sin que toques nada ──
// Genera una tanda semanal si el backlog de piezas no publicadas es bajo.
const CADENCE_DAYS = 7;
const CADENCE_BACKLOG_MIN = 6; // si hay menos de esto sin publicar, rellena
let cadenceRunning = false;
export async function runContentCadence() {
    if (cadenceRunning || !process.env.ANTHROPIC_API_KEY) return { skipped: true };
    cadenceRunning = true;
    try {
        const backlog = await ContentPiece.countDocuments({ status: { $in: ['idea', 'draft', 'ready'] } });
        const lastAgent = await ContentPiece.findOne({ source: 'agent' }).sort({ createdAt: -1 }).select('createdAt');
        const daysSince = lastAgent ? (Date.now() - new Date(lastAgent.createdAt).getTime()) / 86400000 : Infinity;
        // Nunca más de una tanda por día (evita spam por reinicios del server)
        if (daysSince < 1) return { skipped: true, reason: 'generado hoy' };
        // Rellena si pasó la semana O si el backlog está bajo
        if (daysSince < CADENCE_DAYS && backlog >= CADENCE_BACKLOG_MIN) return { skipped: true, backlog, daysSince: Math.round(daysSince) };
        const { created } = await generateSuggestions(6);
        console.log(`[ContentCadence] +${created.length} ideas (backlog previo ${backlog}, ${Math.round(daysSince)}d desde la última)`);
        return { generated: created.length };
    } catch (e) {
        console.error('[ContentCadence] error:', e.message);
        return { error: e.message };
    } finally {
        cadenceRunning = false;
    }
}

// Scheduler: publica las piezas vencidas. Lo llama un intervalo en server.js.
let publishingRunning = false;
export async function runScheduledPublishing() {
    if (publishingRunning) return { skipped: true };
    publishingRunning = true;
    const summary = { intentadas: 0, publicadas: 0, fallidas: 0 };
    try {
        const due = await ContentPiece.find({
            autoPublish: true,
            status: { $ne: 'published' },
            scheduledFor: { $ne: null, $lte: new Date() },
        }).limit(10);
        for (const piece of due) {
            summary.intentadas++;
            const r = await publishPiece(piece);
            if (r.ok) summary.publicadas++;
            else summary.fallidas++;
        }
        if (summary.intentadas) console.log(`[SocialPublisher] ${JSON.stringify(summary)}`);
    } catch (e) {
        console.error('[SocialPublisher] error:', e.message);
    } finally {
        publishingRunning = false;
    }
    return summary;
}

// ════════════════════════════════════════
// Competidores — CRUD
// ════════════════════════════════════════
export const listCompetitors = asyncHandler(async (req, res) => {
    let comps = await Competitor.find().sort({ 'lastScan.followers': -1 });
    // Primera vez: sembrar la watchlist por defecto
    if (comps.length === 0) {
        await Competitor.insertMany(DEFAULT_COMPETITORS.map(u => ({ username: u })), { ordered: false });
        comps = await Competitor.find();
    }
    res.json({ success: true, data: comps });
});

export const addCompetitor = asyncHandler(async (req, res) => {
    const username = (req.body.username || '').toLowerCase().trim().replace(/^@/, '');
    if (!username) { res.status(400); throw new Error('username requerido'); }

    // Validar que Business Discovery pueda leerla antes de guardar
    const pageToken = await getPageToken();
    if (pageToken) {
        const r = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}?fields=business_discovery.username(${username}){username,followers_count}&access_token=${pageToken}`);
        const data = await r.json();
        if (!data.business_discovery) {
            res.status(422);
            throw new Error(`No se puede leer @${username}: la cuenta no existe o no es business/creator`);
        }
    }
    const comp = await Competitor.findOneAndUpdate(
        { username },
        { username, active: true },
        { new: true, upsert: true }
    );
    SCAN_CACHE = null;
    res.status(201).json({ success: true, data: comp });
});

export const removeCompetitor = asyncHandler(async (req, res) => {
    await Competitor.findByIdAndDelete(req.params.id);
    SCAN_CACHE = null;
    res.json({ success: true });
});

// ════════════════════════════════════════
// GET /social/competitors/scan — el radar
// Escanea cada cuenta vía Business Discovery y rankea sus posts
// de los últimos 14 días por engagement.
// ════════════════════════════════════════
export const scanCompetitors = asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    if (!force && SCAN_CACHE && Date.now() - SCAN_CACHE.ts < SCAN_TTL) {
        return res.json({ success: true, data: SCAN_CACHE.data, cached: true });
    }

    const pageToken = await getPageToken();
    if (!pageToken) { res.status(500); throw new Error('No Meta page token'); }

    const comps = await Competitor.find({ active: true });
    const since = Date.now() - 14 * 86400000;

    const results = await Promise.allSettled(comps.map(async (c) => {
        const fields = `business_discovery.username(${c.username}){username,name,followers_count,media_count,profile_picture_url,media.limit(30){caption,like_count,comments_count,media_type,permalink,timestamp}}`;
        const r = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}?fields=${encodeURIComponent(fields)}&access_token=${pageToken}`);
        const data = await r.json();
        const bd = data.business_discovery;
        if (!bd) throw new Error(data.error?.message || 'sin datos');

        const media = (bd.media?.data || []).map(m => ({
            username: bd.username,
            caption: (m.caption || '').slice(0, 200),
            likes: m.like_count || 0,
            comments: m.comments_count || 0,
            engagement: (m.like_count || 0) + (m.comments_count || 0) * 3,
            type: m.media_type,
            url: m.permalink,
            date: m.timestamp,
            // Engagement relativo al tamaño de la cuenta (por mil seguidores):
            // permite comparar cuentas de 5K contra cuentas de 170K.
            engagementPerK: bd.followers_count
                ? +((((m.like_count || 0) + (m.comments_count || 0)) / bd.followers_count) * 1000).toFixed(2)
                : 0,
        }));
        const recent = media.filter(m => new Date(m.date).getTime() >= since);

        // Actualizar snapshot del competidor
        await Competitor.updateOne({ _id: c._id }, {
            lastScan: { followers: bd.followers_count, mediaCount: bd.media_count, scannedAt: new Date() },
        });

        const engSum = recent.reduce((s, m) => s + m.likes + m.comments, 0);
        return {
            username: bd.username,
            name: bd.name || bd.username,
            followers: bd.followers_count,
            mediaCount: bd.media_count,
            profilePic: bd.profile_picture_url || '',
            postsLast14d: recent.length,
            avgEngagement: recent.length ? Math.round(engSum / recent.length) : 0,
            topPosts: recent.sort((a, b) => b.engagement - a.engagement).slice(0, 5),
        };
    }));

    const accounts = [];
    const errors = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') accounts.push(r.value);
        else errors.push({ username: comps[i].username, error: r.reason?.message || 'error' });
    });

    // Ranking global: los mejores posts de TODA la competencia,
    // por engagement relativo (viralidad) y por volumen absoluto.
    const allPosts = accounts.flatMap(a => a.topPosts);
    const data = {
        accounts: accounts.sort((a, b) => b.followers - a.followers),
        topByVirality: [...allPosts].sort((a, b) => b.engagementPerK - a.engagementPerK).slice(0, 10),
        topByVolume: [...allPosts].sort((a, b) => b.engagement - a.engagement).slice(0, 10),
        errors,
        scannedAt: new Date().toISOString(),
    };

    SCAN_CACHE = { data, ts: Date.now() };
    res.json({ success: true, data });
});
