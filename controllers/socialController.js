import asyncHandler from 'express-async-handler';

const CACHE = { data: null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 min

const PAGE_ID = '855962324262046';
const IG_ID = '17841477846360365';

async function getPageToken() {
    const userToken = process.env.META_ACCESS_TOKEN;
    if (!userToken) return null;
    const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`);
    const data = await res.json();
    return data.data?.find(p => p.id === PAGE_ID)?.access_token || null;
}

// GET /social/metrics
export const getSocialMetrics = asyncHandler(async (req, res) => {
    // Return cache if fresh
    if (CACHE.data && Date.now() - CACHE.ts < CACHE_TTL) {
        return res.json({ success: true, data: CACHE.data, cached: true });
    }

    const pageToken = await getPageToken();
    if (!pageToken) {
        return res.json({ success: true, data: mockData(), mock: true });
    }

    try {
        const [fb, ig, igMedia] = await Promise.all([
            fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}?fields=name,followers_count,fan_count&access_token=${pageToken}`).then(r => r.json()),
            fetch(`https://graph.facebook.com/v21.0/${IG_ID}?fields=name,biography,followers_count,media_count,profile_picture_url&access_token=${pageToken}`).then(r => r.json()),
            fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media?fields=like_count,comments_count,timestamp,media_type,caption&limit=20&access_token=${pageToken}`).then(r => r.json()),
        ]);

        // Calculate IG engagement from recent posts
        const posts = igMedia.data || [];
        const totalEngagement = posts.reduce((sum, p) => sum + (p.like_count || 0) + (p.comments_count || 0), 0);
        const avgEngagement = posts.length > 0 ? (totalEngagement / posts.length).toFixed(1) : 0;
        const engagementRate = ig.followers_count > 0 && posts.length > 0
            ? ((totalEngagement / posts.length / ig.followers_count) * 100).toFixed(2) + '%'
            : '—';

        const result = {
            instagram: {
                followers: ig.followers_count || 0,
                posts: ig.media_count || 0,
                engagement: engagementRate,
                avgLikes: posts.length > 0 ? Math.round(posts.reduce((s, p) => s + (p.like_count || 0), 0) / posts.length) : 0,
                profilePic: ig.profile_picture_url || '',
                bio: ig.biography || '',
            },
            facebook: {
                followers: fb.followers_count || fb.fan_count || 0,
                likes: fb.fan_count || 0,
                posts: '—',
                engagement: '—',
            },
            tiktok: null,
            threads: null,
            x: null,
            linkedin: null,
            web: null,
        };

        CACHE.data = result;
        CACHE.ts = Date.now();
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Social] Meta API error:', err.message);
        res.json({ success: true, data: mockData(), mock: true, error: err.message });
    }
});

function mockData() {
    return {
        instagram: { followers: '—', posts: '—', engagement: '—', avgLikes: '—' },
        facebook: { followers: '—', likes: '—', posts: '—', engagement: '—' },
        tiktok: null, threads: null, x: null, linkedin: null, web: null,
    };
}
