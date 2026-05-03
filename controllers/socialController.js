import asyncHandler from 'express-async-handler';
import { getOverview } from '../services/googleAnalyticsService.js';

const CACHE = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 min

const PAGE_ID = '855962324262046';
const IG_ID = '17841477846360365';

function cached(key, ttl = CACHE_TTL) {
    if (CACHE[key] && Date.now() - CACHE[key].ts < ttl) return CACHE[key].data;
    return null;
}
function setCache(key, data) { CACHE[key] = { data, ts: Date.now() }; }

async function getPageToken() {
    const c = cached('pageToken', 60 * 60 * 1000); // 1h cache for token
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

// ════════════════════════════════════════
// GET /social/metrics — All platforms overview
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
// GET /social/posts/:platform — Recent posts with individual metrics
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
            id: p.id,
            likes: p.like_count || 0,
            comments: p.comments_count || 0,
            type: p.media_type || 'IMAGE',
            caption: p.caption || '',
            date: p.timestamp,
            url: p.permalink || '',
            mediaUrl: p.media_url || p.thumbnail_url || '',
        }));
    } else if (platform === 'facebook') {
        const r = await fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}/posts?fields=message,created_time,full_picture,likes.summary(true),comments.summary(true),shares,permalink_url&limit=20&access_token=${pageToken}`);
        const data = await r.json();
        posts = (data.data || []).map(p => ({
            id: p.id,
            likes: p.likes?.summary?.total_count || 0,
            comments: p.comments?.summary?.total_count || 0,
            shares: p.shares?.count || 0,
            caption: p.message || '',
            date: p.created_time,
            url: p.permalink_url || '',
            mediaUrl: p.full_picture || '',
        }));
    }

    setCache(`posts_${platform}`, posts);
    res.json({ success: true, data: posts });
});

// ════════════════════════════════════════
// POST /social/publish — Publish to IG or FB
// ════════════════════════════════════════
export const publishPost = asyncHandler(async (req, res) => {
    const { platform, message, imageUrl } = req.body;
    if (!platform || (!message && !imageUrl)) {
        res.status(400);
        throw new Error('platform and (message or imageUrl) are required');
    }

    const pageToken = await getPageToken();
    if (!pageToken) {
        res.status(500);
        throw new Error('No Meta page token available');
    }

    let result;

    if (platform === 'facebook') {
        // Publish to Facebook Page
        const body = { access_token: pageToken };
        if (message) body.message = message;
        if (imageUrl) body.url = imageUrl;

        const endpoint = imageUrl
            ? `https://graph.facebook.com/v21.0/${PAGE_ID}/photos`
            : `https://graph.facebook.com/v21.0/${PAGE_ID}/feed`;

        const r = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        result = await r.json();
        if (result.error) throw new Error(result.error.message);

    } else if (platform === 'instagram') {
        // IG requires 2-step: create container → publish
        if (!imageUrl) {
            res.status(400);
            throw new Error('Instagram requires an image URL');
        }

        // Step 1: Create media container
        const containerBody = {
            image_url: imageUrl,
            access_token: pageToken,
        };
        if (message) containerBody.caption = message;

        const containerRes = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerBody),
        });
        const container = await containerRes.json();
        if (container.error) throw new Error(container.error.message);

        // Step 2: Publish the container
        const publishRes = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creation_id: container.id,
                access_token: pageToken,
            }),
        });
        result = await publishRes.json();
        if (result.error) throw new Error(result.error.message);
    } else {
        res.status(400);
        throw new Error(`Platform "${platform}" not supported for publishing`);
    }

    // Clear cache so new post appears
    delete CACHE[`posts_${platform}`];
    delete CACHE['metrics'];

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

    // Best performing post
    const bestPost = posts.length > 0
        ? posts.reduce((best, p) => (p.like_count || 0) > (best.like_count || 0) ? p : best, posts[0])
        : null;

    return {
        followers: profile.followers_count || 0,
        posts: profile.media_count || 0,
        engagement: engagementRate,
        avgLikes: posts.length > 0 ? Math.round(totalLikes / posts.length) : 0,
        avgComments: posts.length > 0 ? Math.round(totalComments / posts.length) : 0,
        totalLikes,
        totalComments,
        profilePic: profile.profile_picture_url || '',
        bio: profile.biography || '',
        bestPost: bestPost ? {
            likes: bestPost.like_count || 0,
            comments: bestPost.comments_count || 0,
            caption: (bestPost.caption || '').slice(0, 100),
            url: bestPost.permalink || '',
            type: bestPost.media_type || 'IMAGE',
        } : null,
        recentPosts: posts.slice(0, 6).map(p => ({
            likes: p.like_count || 0,
            comments: p.comments_count || 0,
            type: p.media_type || 'IMAGE',
            caption: (p.caption || '').slice(0, 80),
            date: p.timestamp,
            url: p.permalink || '',
        })),
    };
}

async function fetchFacebook(pageToken) {
    const [page, postsRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}?fields=name,followers_count,fan_count&access_token=${pageToken}`).then(r => r.json()),
        fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}/posts?fields=message,created_time,full_picture,likes.summary(true),comments.summary(true),shares,permalink_url&limit=15&access_token=${pageToken}`).then(r => r.json()).catch(() => ({ data: [] })),
    ]);

    const posts = postsRes.data || [];
    const totalReactions = posts.reduce((s, p) => s + (p.likes?.summary?.total_count || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.comments?.summary?.total_count || 0), 0);
    const totalShares = posts.reduce((s, p) => s + (p.shares?.count || 0), 0);

    return {
        followers: page.followers_count || page.fan_count || 0,
        likes: page.fan_count || 0,
        posts: posts.length,
        engagement: posts.length > 0 ? Math.round((totalReactions + totalComments + totalShares) / posts.length) : 0,
        totalReactions,
        totalComments,
        totalShares,
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
