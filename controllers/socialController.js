import asyncHandler from 'express-async-handler';
import { getOverview } from '../services/googleAnalyticsService.js';
import cloudinary from '../config/cloudinary.js';

const CACHE = {};
const CACHE_TTL = 15 * 60 * 1000;
const PAGE_ID = '855962324262046';
const IG_ID = '17841477846360365';

function cached(key, ttl = CACHE_TTL) {
    if (CACHE[key] && Date.now() - CACHE[key].ts < ttl) return CACHE[key].data;
    return null;
}
function setCache(key, data) { CACHE[key] = { data, ts: Date.now() }; }

export async function getPageToken() {
    const c = cached('pageToken', 3600000);
    if (c) return c;
    const userToken = process.env.META_ACCESS_TOKEN;
    if (!userToken) return null;
    try {
        const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`);
        const data = await res.json();
        const token = data.data?.find(p => p.id === PAGE_ID)?.access_token || null;
        if (token) setCache('pageToken', token);
        return token;
    } catch { return null; }
}

// Publica a Meta (IG/FB). Reutilizable por el endpoint y el scheduler.
// Devuelve { ok, postId, permalink, error }.
export async function publishToMeta({ platform, message, imageUrl, mediaUrls }) {
    const pageToken = await getPageToken();
    if (!pageToken) return { ok: false, error: 'No hay page token de Meta' };
    const images = (Array.isArray(mediaUrls) && mediaUrls.length ? mediaUrls : (imageUrl ? [imageUrl] : [])).filter(Boolean);
    try {
        // ── Carrusel de Instagram (2-10 imágenes) ──
        if (platform === 'instagram' && images.length > 1) {
            const children = [];
            for (const url of images.slice(0, 10)) {
                const cr = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: pageToken }),
                });
                const cj = await cr.json();
                if (cj.error) return { ok: false, error: `Carrusel (imagen): ${cj.error.message}` };
                children.push(cj.id);
            }
            const parentBody = { media_type: 'CAROUSEL', children: children.join(','), access_token: pageToken };
            if (message) parentBody.caption = message;
            const pr = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parentBody),
            });
            const parent = await pr.json();
            if (parent.error) return { ok: false, error: `Carrusel (contenedor): ${parent.error.message}` };
            const pubr = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media_publish`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creation_id: parent.id, access_token: pageToken }),
            });
            const pub = await pubr.json();
            if (pub.error) return { ok: false, error: pub.error.message };
            let permalink = '';
            try { permalink = (await (await fetch(`https://graph.facebook.com/v21.0/${pub.id}?fields=permalink&access_token=${pageToken}`)).json()).permalink || ''; } catch { /* noop */ }
            return { ok: true, postId: pub.id, permalink };
        }

        if (platform === 'facebook') {
            const fbImg = images[0] || '';
            const body = { access_token: pageToken };
            if (message) body.message = message;
            if (fbImg) body.url = fbImg;
            const endpoint = fbImg
                ? `https://graph.facebook.com/v21.0/${PAGE_ID}/photos`
                : `https://graph.facebook.com/v21.0/${PAGE_ID}/feed`;
            const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const j = await r.json();
            if (j.error) return { ok: false, error: j.error.message };
            const postId = j.post_id || j.id;
            return { ok: true, postId, permalink: postId ? `https://facebook.com/${postId}` : '' };
        }
        if (platform === 'instagram') {
            if (!images.length) return { ok: false, error: 'Instagram requiere una imagen' };
            const containerBody = { image_url: images[0], access_token: pageToken };
            if (message) containerBody.caption = message;
            const cRes = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(containerBody) });
            const container = await cRes.json();
            if (container.error) return { ok: false, error: container.error.message };
            const pRes = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: pageToken }) });
            const pub = await pRes.json();
            if (pub.error) return { ok: false, error: pub.error.message };
            // permalink real
            let permalink = '';
            try {
                const pl = await (await fetch(`https://graph.facebook.com/v21.0/${pub.id}?fields=permalink&access_token=${pageToken}`)).json();
                permalink = pl.permalink || '';
            } catch { /* noop */ }
            return { ok: true, postId: pub.id, permalink };
        }
        return { ok: false, error: `Plataforma no soportada para auto-publicar: ${platform} (TikTok requiere aprobación de su API)` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

// ════════════════════════════════════════
// GET /social/metrics
// ════════════════════════════════════════
export const getSocialMetrics = asyncHandler(async (req, res) => {
    const c = cached('metrics');
    if (c) return res.json({ success: true, data: c, cached: true });

    const pageToken = await getPageToken();
    const [igData, fbData, webData] = await Promise.allSettled([
        pageToken ? fetchInstagram(pageToken) : Promise.resolve(null),
        pageToken ? fetchFacebook(pageToken) : Promise.resolve(null),
        fetchWebData(),
    ]);

    const result = {
        instagram: igData.status === 'fulfilled' ? igData.value : null,
        facebook: fbData.status === 'fulfilled' ? fbData.value : null,
        web: webData.status === 'fulfilled' ? webData.value : null,
        tiktok: null, threads: null, x: null, linkedin: null,
    };

    setCache('metrics', result);
    res.json({ success: true, data: result, mock: !pageToken });
});

// ════════════════════════════════════════
// GET /social/insights/:platform — Time series + totals for charts
// ════════════════════════════════════════
export const getSocialInsights = asyncHandler(async (req, res) => {
    const { platform } = req.params;
    const days = parseInt(req.query.days) || 14;
    const c = cached(`insights_${platform}_${days}`);
    if (c) return res.json({ success: true, data: c, cached: true });

    const pageToken = await getPageToken();
    if (!pageToken) return res.json({ success: true, data: null, mock: true });

    let result = null;

    if (platform === 'instagram') {
        const since = daysAgo(days);
        const until = daysAgo(1);

        const [timeSeries, totals, demographics] = await Promise.allSettled([
            fetch(`https://graph.facebook.com/v21.0/${IG_ID}/insights?metric=reach,follower_count&period=day&metric_type=time_series&since=${since}&until=${until}&access_token=${pageToken}`).then(r => r.json()),
            fetch(`https://graph.facebook.com/v21.0/${IG_ID}/insights?metric=profile_views,total_interactions,likes,comments,shares,saves,accounts_engaged&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${pageToken}`).then(r => r.json()),
            fetch(`https://graph.facebook.com/v21.0/${IG_ID}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&timeframe=last_14_days&access_token=${pageToken}`).then(r => r.json()).catch(() => null),
        ]);

        // Parse time series
        const charts = {};
        if (timeSeries.status === 'fulfilled' && timeSeries.value.data) {
            for (const metric of timeSeries.value.data) {
                charts[metric.name] = (metric.values || []).map(v => ({
                    date: v.end_time?.slice(5, 10), // MM-DD
                    value: v.value || 0,
                }));
            }
        }

        // Parse totals
        const totalsMap = {};
        if (totals.status === 'fulfilled' && totals.value.data) {
            for (const metric of totals.value.data) {
                totalsMap[metric.name] = metric.total_value?.value || 0;
            }
        }

        // Parse demographics
        let demoData = null;
        if (demographics.status === 'fulfilled' && demographics.value?.data?.[0]) {
            const raw = demographics.value.data[0].total_value?.breakdowns?.[0]?.results || [];
            demoData = raw.slice(0, 10).map(r => ({
                label: r.dimension_values?.join(', ') || '?',
                value: r.value || 0,
            }));
        }

        result = { charts, totals: totalsMap, demographics: demoData };
    }

    if (result) setCache(`insights_${platform}_${days}`, result);
    res.json({ success: true, data: result });
});

// ════════════════════════════════════════
// GET /social/posts/:platform
// ════════════════════════════════════════
export const getSocialPosts = asyncHandler(async (req, res) => {
    const { platform } = req.params;
    const c = cached(`posts_${platform}`);
    if (c) return res.json({ success: true, data: c, cached: true });

    const pageToken = await getPageToken();
    if (!pageToken) return res.json({ success: true, data: [], mock: true });

    let posts = [];
    if (platform === 'instagram') {
        const r = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media?fields=like_count,comments_count,timestamp,media_type,caption,permalink,media_url,thumbnail_url&limit=25&access_token=${pageToken}`);
        const data = await r.json();
        posts = (data.data || []).map(p => ({
            id: p.id, likes: p.like_count || 0, comments: p.comments_count || 0,
            type: p.media_type || 'IMAGE', caption: p.caption || '',
            date: p.timestamp, url: p.permalink || '', mediaUrl: p.media_url || p.thumbnail_url || '',
        }));
    } else if (platform === 'facebook') {
        const r = await fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}/posts?fields=message,created_time,full_picture,likes.summary(true),comments.summary(true),shares,permalink_url&limit=20&access_token=${pageToken}`);
        const data = await r.json();
        posts = (data.data || []).map(p => ({
            id: p.id, likes: p.likes?.summary?.total_count || 0,
            comments: p.comments?.summary?.total_count || 0, shares: p.shares?.count || 0,
            caption: p.message || '', date: p.created_time,
            url: p.permalink_url || '', mediaUrl: p.full_picture || '',
        }));
    }

    setCache(`posts_${platform}`, posts);
    res.json({ success: true, data: posts });
});

// ════════════════════════════════════════
// POST /social/publish
// ════════════════════════════════════════
export const publishPost = asyncHandler(async (req, res) => {
    const { platform, message, imageUrl } = req.body;
    if (!platform || (!message && !imageUrl)) {
        res.status(400); throw new Error('platform and (message or imageUrl) required');
    }
    const result = await publishToMeta({ platform, message, imageUrl });
    if (!result.ok) { res.status(500); throw new Error(result.error || 'Error al publicar'); }

    delete CACHE[`posts_${platform}`]; delete CACHE['metrics'];
    res.json({ success: true, data: result, message: `Published to ${platform}` });
});

// ════════════════════════════════════════
// Fetch helpers
// ════════════════════════════════════════
async function fetchInstagram(pageToken) {
    const [profile, media] = await Promise.all([
        fetch(`https://graph.facebook.com/v21.0/${IG_ID}?fields=name,biography,followers_count,media_count,profile_picture_url&access_token=${pageToken}`).then(r => r.json()),
        fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media?fields=like_count,comments_count,timestamp,media_type,caption,permalink&limit=25&access_token=${pageToken}`).then(r => r.json()),
    ]);
    const posts = media.data || [];
    const totalLikes = posts.reduce((s, p) => s + (p.like_count || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.comments_count || 0), 0);
    const avgEngPerPost = posts.length > 0 ? (totalLikes + totalComments) / posts.length : 0;
    const engagementRate = profile.followers_count > 0 && posts.length > 0
        ? ((avgEngPerPost / profile.followers_count) * 100).toFixed(2) + '%' : '—';
    const bestPost = posts.length > 0 ? posts.reduce((b, p) => (p.like_count || 0) > (b.like_count || 0) ? p : b, posts[0]) : null;

    return {
        followers: profile.followers_count || 0, posts: profile.media_count || 0,
        engagement: engagementRate,
        avgLikes: posts.length > 0 ? Math.round(totalLikes / posts.length) : 0,
        avgComments: posts.length > 0 ? Math.round(totalComments / posts.length) : 0,
        totalLikes, totalComments,
        profilePic: profile.profile_picture_url || '', bio: profile.biography || '',
        bestPost: bestPost ? { likes: bestPost.like_count || 0, comments: bestPost.comments_count || 0, caption: (bestPost.caption || '').slice(0, 100), url: bestPost.permalink || '', type: bestPost.media_type || 'IMAGE' } : null,
        recentPosts: posts.slice(0, 6).map(p => ({ likes: p.like_count || 0, comments: p.comments_count || 0, type: p.media_type || 'IMAGE', caption: (p.caption || '').slice(0, 80), date: p.timestamp, url: p.permalink || '' })),
    };
}

async function fetchFacebook(pageToken) {
    const [page, postsRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}?fields=name,followers_count,fan_count&access_token=${pageToken}`).then(r => r.json()),
        fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}/posts?fields=message,created_time,likes.summary(true),comments.summary(true),shares&limit=15&access_token=${pageToken}`).then(r => r.json()).catch(() => ({ data: [] })),
    ]);
    const posts = postsRes.data || [];
    const totalReactions = posts.reduce((s, p) => s + (p.likes?.summary?.total_count || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.comments?.summary?.total_count || 0), 0);
    const totalShares = posts.reduce((s, p) => s + (p.shares?.count || 0), 0);
    return {
        followers: page.followers_count || page.fan_count || 0, likes: page.fan_count || 0,
        posts: posts.length, engagement: posts.length > 0 ? Math.round((totalReactions + totalComments + totalShares) / posts.length) : 0,
        totalReactions, totalComments, totalShares,
    };
}

async function fetchWebData() {
    try {
        const overview = await getOverview(7);
        if (!overview) return null;
        return {
            visitors: overview.totalUsers || overview.activeUsers || 0,
            pageviews: overview.screenPageViews || 0,
            bounce: overview.bounceRate ? (parseFloat(overview.bounceRate) * 100).toFixed(1) + '%' : '—',
            avgTime: overview.averageSessionDuration ? Math.round(parseFloat(overview.averageSessionDuration)) + 's' : '—',
        };
    } catch { return null; }
}

// ════════════════════════════════════════
// POST /social/generate-image — Gemini Imagen + Cloudinary
// ════════════════════════════════════════
export const generateImage = asyncHandler(async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) { res.status(400); throw new Error('prompt is required'); }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) { res.status(500); throw new Error('GEMINI_API_KEY not configured'); }

    console.log(`[Social:GenImage] "${prompt.slice(0, 80)}..."`);

    // Try models in order of preference
    const models = [
        { name: 'gemini-2.5-flash-image', type: 'generateContent' },
        { name: 'gemini-3-pro-image-preview', type: 'generateContent' },
        { name: 'imagen-4.0-fast-generate-001', type: 'predict' },
        { name: 'imagen-4.0-generate-001', type: 'predict' },
    ];

    for (const model of models) {
        try {
            let b64, mime = 'image/png';

            if (model.type === 'generateContent') {
                const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: `Generate a professional social media image: ${prompt}` }] }],
                        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
                    }),
                });
                const data = await r.json();
                if (data.error) { console.log(`[GenImage] ${model.name}: ${data.error.message?.slice(0, 80)}`); continue; }
                const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                if (!imgPart) continue;
                b64 = imgPart.inlineData.data;
                mime = imgPart.inlineData.mimeType || mime;
            } else {
                const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.name}:predict?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: '1:1' } }),
                });
                const data = await r.json();
                if (data.error) { console.log(`[GenImage] ${model.name}: ${data.error.message?.slice(0, 80)}`); continue; }
                b64 = data?.predictions?.[0]?.bytesBase64Encoded;
                if (!b64) continue;
            }

            // Upload to Cloudinary
            const upload = await cloudinary.uploader.upload(`data:${mime};base64,${b64}`, { folder: 'tesipedia-social' });
            console.log(`[Social:GenImage] ${model.name} → ${upload.secure_url}`);
            return res.json({ success: true, url: upload.secure_url, publicId: upload.public_id, source: model.name });
        } catch (err) {
            console.log(`[GenImage] ${model.name} failed:`, err.message?.slice(0, 80));
        }
    }

    // All models failed
    res.status(402);
    throw new Error('La generación de imágenes con IA requiere habilitar billing en Google AI Studio (aistudio.google.com → Settings → Billing). El costo es ~$0.02 por imagen. Por ahora, copia el prompt y genera en gemini.google.com (web) gratis.');
});

// ════════════════════════════════════════
// POST /social/upload-image — Save external image to Cloudinary
// ════════════════════════════════════════
export const uploadImage = asyncHandler(async (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl) { res.status(400); throw new Error('imageUrl required'); }

    const upload = await cloudinary.uploader.upload(imageUrl, { folder: 'tesipedia-social' });
    res.json({ success: true, url: upload.secure_url, publicId: upload.public_id });
});
