import asyncHandler from 'express-async-handler';
import { getOverview } from '../services/googleAnalyticsService.js';

const CACHE = { data: null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 min

const PAGE_ID = '855962324262046';
const IG_ID = '17841477846360365';

async function getPageToken() {
    const userToken = process.env.META_ACCESS_TOKEN;
    if (!userToken) return null;
    try {
        const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`);
        const data = await res.json();
        return data.data?.find(p => p.id === PAGE_ID)?.access_token || null;
    } catch { return null; }
}

async function fetchInstagramData(pageToken) {
    const [profile, media] = await Promise.all([
        fetch(`https://graph.facebook.com/v21.0/${IG_ID}?fields=name,biography,followers_count,media_count,profile_picture_url&access_token=${pageToken}`).then(r => r.json()),
        fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media?fields=like_count,comments_count,timestamp,media_type,caption,permalink&limit=25&access_token=${pageToken}`).then(r => r.json()),
    ]);

    const posts = media.data || [];
    const totalLikes = posts.reduce((s, p) => s + (p.like_count || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.comments_count || 0), 0);
    const totalEngagement = totalLikes + totalComments;
    const avgEngPerPost = posts.length > 0 ? totalEngagement / posts.length : 0;
    const engagementRate = profile.followers_count > 0 && posts.length > 0
        ? ((avgEngPerPost / profile.followers_count) * 100).toFixed(2) + '%'
        : '—';

    // Recent posts for display
    const recentPosts = posts.slice(0, 6).map(p => ({
        likes: p.like_count || 0,
        comments: p.comments_count || 0,
        type: p.media_type || 'IMAGE',
        caption: (p.caption || '').slice(0, 80),
        date: p.timestamp,
        url: p.permalink || '',
    }));

    return {
        followers: profile.followers_count || 0,
        posts: profile.media_count || 0,
        engagement: engagementRate,
        avgLikes: posts.length > 0 ? Math.round(totalLikes / posts.length) : 0,
        totalLikes,
        totalComments,
        profilePic: profile.profile_picture_url || '',
        bio: profile.biography || '',
        recentPosts,
    };
}

async function fetchFacebookData(pageToken) {
    const [page, posts] = await Promise.all([
        fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}?fields=name,followers_count,fan_count,new_like_count&access_token=${pageToken}`).then(r => r.json()),
        fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}/posts?fields=message,created_time,likes.summary(true),comments.summary(true),shares&limit=10&access_token=${pageToken}`).then(r => r.json()).catch(() => ({ data: [] })),
    ]);

    const fbPosts = posts.data || [];
    const totalLikes = fbPosts.reduce((s, p) => s + (p.likes?.summary?.total_count || 0), 0);
    const totalComments = fbPosts.reduce((s, p) => s + (p.comments?.summary?.total_count || 0), 0);
    const totalShares = fbPosts.reduce((s, p) => s + (p.shares?.count || 0), 0);

    return {
        followers: page.followers_count || page.fan_count || 0,
        likes: page.fan_count || 0,
        posts: fbPosts.length,
        engagement: fbPosts.length > 0 ? Math.round((totalLikes + totalComments + totalShares) / fbPosts.length) : 0,
        totalReactions: totalLikes,
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
    } catch {
        return null;
    }
}

// GET /social/metrics
export const getSocialMetrics = asyncHandler(async (req, res) => {
    if (CACHE.data && Date.now() - CACHE.ts < CACHE_TTL) {
        return res.json({ success: true, data: CACHE.data, cached: true });
    }

    const pageToken = await getPageToken();

    // Fetch all sources in parallel
    const [igData, fbData, webData] = await Promise.allSettled([
        pageToken ? fetchInstagramData(pageToken) : Promise.resolve(null),
        pageToken ? fetchFacebookData(pageToken) : Promise.resolve(null),
        fetchWebData(),
    ]);

    const result = {
        instagram: igData.status === 'fulfilled' && igData.value ? igData.value : { followers: '—', posts: '—', engagement: '—', avgLikes: '—' },
        facebook: fbData.status === 'fulfilled' && fbData.value ? fbData.value : { followers: '—', likes: '—', posts: '—', engagement: '—' },
        tiktok: null,
        threads: null,
        x: null,
        linkedin: null,
        web: webData.status === 'fulfilled' && webData.value ? webData.value : null,
    };

    const hasMeta = pageToken && (igData.status === 'fulfilled' && igData.value);

    CACHE.data = result;
    CACHE.ts = Date.now();
    res.json({ success: true, data: result, mock: !hasMeta });
});
