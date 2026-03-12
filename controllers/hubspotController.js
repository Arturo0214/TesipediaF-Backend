import asyncHandler from 'express-async-handler';

const HUBSPOT_BASE = 'https://api.hubapi.com';

const hubspotFetch = async (endpoint, params = {}) => {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN no configurado');

  const url = new URL(`${HUBSPOT_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      url.searchParams.set(k, v.join(','));
    } else {
      url.searchParams.set(k, String(v));
    }
  });

  console.log('[HubSpot] Fetching:', endpoint);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error('[HubSpot] API error:', res.status, errorBody);
    throw new Error(`HubSpot API error: ${res.status} - ${errorBody.substring(0, 200)}`);
  }

  const data = await res.json();
  console.log(`[HubSpot] ${endpoint} => ${data.results?.length ?? 0} results`);
  return data;
};

// @desc    Get HubSpot deals
// @route   GET /api/v1/hubspot/deals
// @access  Admin
export const getDeals = asyncHandler(async (req, res) => {
  const { limit = 50, after } = req.query;
  const params = {
    limit,
    properties: ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'createdate', 'hs_lastmodifieddate', 'hubspot_owner_id'],
  };
  if (after) params.after = after;
  const data = await hubspotFetch('/crm/v3/objects/deals', params);
  res.json({ results: data.results || [], paging: data.paging || null, total: data.total || data.results?.length || 0 });
});

// @desc    Get HubSpot contacts
// @route   GET /api/v1/hubspot/contacts
// @access  Admin
export const getContacts = asyncHandler(async (req, res) => {
  const { limit = 100, after } = req.query;
  const params = {
    limit,
    properties: ['firstname', 'lastname', 'email', 'phone', 'createdate', 'hs_lead_status', 'lifecyclestage', 'company'],
  };
  if (after) params.after = after;
  const data = await hubspotFetch('/crm/v3/objects/contacts', params);
  res.json({ results: data.results || [], paging: data.paging || null, total: data.total || data.results?.length || 0 });
});

// @desc    Get HubSpot deal pipelines
// @route   GET /api/v1/hubspot/pipelines
// @access  Admin
export const getPipelines = asyncHandler(async (req, res) => {
  const data = await hubspotFetch('/crm/v3/pipelines/deals');
  res.json({ results: data.results || [] });
});

// @desc    Full HubSpot dashboard summary with conversion metrics
// @route   GET /api/v1/hubspot/summary
// @access  Admin
export const getSummary = asyncHandler(async (req, res) => {
  const [dealsResult, contactsResult, pipelinesResult] = await Promise.allSettled([
    hubspotFetch('/crm/v3/objects/deals', {
      limit: 100,
      properties: ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'createdate', 'hs_lastmodifieddate'],
    }),
    hubspotFetch('/crm/v3/objects/contacts', {
      limit: 100,
      properties: ['firstname', 'lastname', 'email', 'phone', 'createdate', 'lifecyclestage', 'hs_lead_status', 'company', 'hs_lastmodifieddate'],
    }),
    hubspotFetch('/crm/v3/pipelines/deals'),
  ]);

  const deals = dealsResult.status === 'fulfilled' ? (dealsResult.value.results || []) : [];
  const contacts = contactsResult.status === 'fulfilled' ? (contactsResult.value.results || []) : [];
  const pipelines = pipelinesResult.status === 'fulfilled' ? (pipelinesResult.value.results || []) : [];

  if (dealsResult.status === 'rejected') console.error('[HubSpot] Deals failed:', dealsResult.reason?.message);
  if (contactsResult.status === 'rejected') console.error('[HubSpot] Contacts failed:', contactsResult.reason?.message);
  if (pipelinesResult.status === 'rejected') console.error('[HubSpot] Pipelines failed:', pipelinesResult.reason?.message);

  // ── Stage map from pipelines ──
  const stageMap = {};
  const closedWonStages = new Set();
  const closedLostStages = new Set();
  pipelines.forEach(p => {
    (p.stages || []).forEach(s => {
      stageMap[s.id] = { label: s.label, displayOrder: s.displayOrder, pipelineId: p.id, pipelineLabel: p.label };
      const lower = (s.label || '').toLowerCase();
      if (lower.includes('won') || lower.includes('ganado') || lower.includes('cerrado ganado') || s.id === 'closedwon') closedWonStages.add(s.id);
      if (lower.includes('lost') || lower.includes('perdido') || lower.includes('cerrado perdido') || s.id === 'closedlost') closedLostStages.add(s.id);
    });
  });

  // ── Time boundaries ──
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisWeek = new Date(now); thisWeek.setDate(now.getDate() - 7);
  const last30 = new Date(now); last30.setDate(now.getDate() - 30);
  const prev30 = new Date(now); prev30.setDate(now.getDate() - 60);

  // ── Deals aggregation ──
  const dealsByStage = {};
  let totalRevenue = 0;
  let dealsThisMonth = 0;
  let revenueThisMonth = 0;
  let dealsLastMonth = 0;
  let revenueLastMonth = 0;
  let dealsWon = 0;
  let dealsLost = 0;
  let wonRevenue = 0;
  let avgDealSize = 0;

  // Monthly revenue for chart (last 6 months)
  const monthlyRevenue = {};
  const monthlyDeals = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyRevenue[key] = 0;
    monthlyDeals[key] = 0;
  }

  deals.forEach(d => {
    const props = d.properties || {};
    const stage = props.dealstage || 'unknown';
    const amount = parseFloat(props.amount) || 0;
    const created = new Date(props.createdate);
    const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;

    if (!dealsByStage[stage]) {
      dealsByStage[stage] = { count: 0, amount: 0, label: stageMap[stage]?.label || stage };
    }
    dealsByStage[stage].count++;
    dealsByStage[stage].amount += amount;
    totalRevenue += amount;

    if (created >= thisMonth) { dealsThisMonth++; revenueThisMonth += amount; }
    if (created >= lastMonth && created < thisMonth) { dealsLastMonth++; revenueLastMonth += amount; }

    if (closedWonStages.has(stage)) { dealsWon++; wonRevenue += amount; }
    if (closedLostStages.has(stage)) { dealsLost++; }

    if (monthlyRevenue[monthKey] !== undefined) { monthlyRevenue[monthKey] += amount; monthlyDeals[monthKey]++; }
  });

  const totalDealsWithOutcome = dealsWon + dealsLost;
  const winRate = totalDealsWithOutcome > 0 ? Math.round((dealsWon / totalDealsWithOutcome) * 100) : 0;
  avgDealSize = deals.length > 0 ? Math.round(totalRevenue / deals.length) : 0;

  // ── Contacts aggregation ──
  const contactsByLifecycle = {};
  let contactsThisMonth = 0;
  let contactsLastMonth = 0;
  let contactsThisWeek = 0;
  let customersCount = 0;

  // Weekly contacts for chart (last 8 weeks)
  const weeklyContacts = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (i * 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    weeklyContacts.push({
      weekStart: weekStart.toISOString(),
      label: `Sem ${8 - i}`,
      count: 0,
      _start: weekStart,
      _end: weekEnd,
    });
  }

  contacts.forEach(c => {
    const props = c.properties || {};
    const lifecycle = props.lifecyclestage || 'unknown';
    const created = new Date(props.createdate);

    contactsByLifecycle[lifecycle] = (contactsByLifecycle[lifecycle] || 0) + 1;

    if (created >= thisMonth) contactsThisMonth++;
    if (created >= lastMonth && created < thisMonth) contactsLastMonth++;
    if (created >= thisWeek) contactsThisWeek++;
    if (lifecycle === 'customer') customersCount++;

    // Count into weekly buckets
    for (const w of weeklyContacts) {
      if (created >= w._start && created < w._end) { w.count++; break; }
    }
  });

  // Conversion rate: leads who became customers
  const totalLeads = contacts.length;
  const conversionRate = totalLeads > 0 ? Math.round((customersCount / totalLeads) * 100) : 0;

  // Growth rates (month-over-month)
  const contactGrowth = contactsLastMonth > 0 ? Math.round(((contactsThisMonth - contactsLastMonth) / contactsLastMonth) * 100) : (contactsThisMonth > 0 ? 100 : 0);
  const revenueGrowth = revenueLastMonth > 0 ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100) : (revenueThisMonth > 0 ? 100 : 0);

  // ── Recent items ──
  const recentDeals = [...deals]
    .sort((a, b) => new Date(b.properties?.createdate || 0) - new Date(a.properties?.createdate || 0))
    .slice(0, 5)
    .map(d => ({
      id: d.id,
      name: d.properties?.dealname || '',
      amount: parseFloat(d.properties?.amount) || 0,
      stage: stageMap[d.properties?.dealstage]?.label || d.properties?.dealstage || '',
      stageId: d.properties?.dealstage || '',
      closedate: d.properties?.closedate || null,
      created: d.properties?.createdate || null,
    }));

  const recentContacts = [...contacts]
    .sort((a, b) => new Date(b.properties?.createdate || 0) - new Date(a.properties?.createdate || 0))
    .slice(0, 10)
    .map(c => ({
      id: c.id,
      name: `${c.properties?.firstname || ''} ${c.properties?.lastname || ''}`.trim() || c.properties?.email || 'Sin nombre',
      email: c.properties?.email || '',
      phone: c.properties?.phone || '',
      company: c.properties?.company || '',
      lifecycle: c.properties?.lifecyclestage || '',
      leadStatus: c.properties?.hs_lead_status || '',
      created: c.properties?.createdate || null,
    }));

  // Clean weekly data for frontend
  const weeklyData = weeklyContacts.map(w => ({ label: w.label, count: w.count, weekStart: w.weekStart }));

  // Monthly chart data
  const monthlyData = Object.entries(monthlyRevenue).map(([key, rev]) => ({
    month: key,
    label: new Date(key + '-01').toLocaleDateString('es-MX', { month: 'short' }),
    revenue: rev,
    deals: monthlyDeals[key] || 0,
  }));

  res.json({
    kpis: {
      totalContacts: contacts.length,
      contactsThisMonth,
      contactsLastMonth,
      contactsThisWeek,
      contactGrowth,
      totalDeals: deals.length,
      dealsThisMonth,
      dealsLastMonth,
      totalRevenue,
      revenueThisMonth,
      revenueLastMonth,
      revenueGrowth,
      avgDealSize,
      dealsWon,
      dealsLost,
      winRate,
      customersCount,
      conversionRate,
    },
    deals: {
      byStage: dealsByStage,
      recent: recentDeals,
    },
    contacts: {
      byLifecycle: contactsByLifecycle,
      recent: recentContacts,
    },
    charts: {
      weeklyContacts: weeklyData,
      monthlyRevenue: monthlyData,
    },
    pipelines: pipelines.map(p => ({
      id: p.id,
      label: p.label,
      stages: (p.stages || []).map(s => ({ id: s.id, label: s.label, displayOrder: s.displayOrder })),
    })),
    errors: {
      deals: dealsResult.status === 'rejected' ? dealsResult.reason?.message : null,
      contacts: contactsResult.status === 'rejected' ? contactsResult.reason?.message : null,
      pipelines: pipelinesResult.status === 'rejected' ? pipelinesResult.reason?.message : null,
    },
  });
});
