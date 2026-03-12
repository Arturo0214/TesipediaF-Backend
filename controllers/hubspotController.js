import asyncHandler from 'express-async-handler';

const HUBSPOT_BASE = 'https://api.hubapi.com';

const hubspotFetch = async (endpoint, params = {}) => {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN no configurado');

  const url = new URL(`${HUBSPOT_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      v.forEach(val => url.searchParams.append(k, val));
    } else {
      url.searchParams.set(k, v);
    }
  });

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error('HubSpot API error:', res.status, errorBody);
    throw new Error(`HubSpot API error: ${res.status}`);
  }

  return res.json();
};

// @desc    Get HubSpot deals with pipeline stages
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

  res.json({
    results: data.results || [],
    paging: data.paging || null,
    total: data.total || data.results?.length || 0,
  });
});

// @desc    Get HubSpot contacts
// @route   GET /api/v1/hubspot/contacts
// @access  Admin
export const getContacts = asyncHandler(async (req, res) => {
  const { limit = 50, after } = req.query;

  const params = {
    limit,
    properties: ['firstname', 'lastname', 'email', 'phone', 'createdate', 'hs_lead_status', 'lifecyclestage', 'company'],
  };
  if (after) params.after = after;

  const data = await hubspotFetch('/crm/v3/objects/contacts', params);

  res.json({
    results: data.results || [],
    paging: data.paging || null,
    total: data.total || data.results?.length || 0,
  });
});

// @desc    Get HubSpot deal pipeline stages
// @route   GET /api/v1/hubspot/pipelines
// @access  Admin
export const getPipelines = asyncHandler(async (req, res) => {
  const data = await hubspotFetch('/crm/v3/pipelines/deals');

  res.json({
    results: data.results || [],
  });
});

// @desc    Get HubSpot dashboard summary (deals + contacts aggregated)
// @route   GET /api/v1/hubspot/summary
// @access  Admin
export const getSummary = asyncHandler(async (req, res) => {
  // Fetch deals and contacts in parallel
  const [dealsData, contactsData, pipelinesData] = await Promise.all([
    hubspotFetch('/crm/v3/objects/deals', {
      limit: 100,
      properties: ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'createdate', 'hs_lastmodifieddate'],
    }),
    hubspotFetch('/crm/v3/objects/contacts', {
      limit: 100,
      properties: ['firstname', 'lastname', 'email', 'createdate', 'lifecyclestage', 'hs_lead_status'],
    }),
    hubspotFetch('/crm/v3/pipelines/deals'),
  ]);

  const deals = dealsData.results || [];
  const contacts = contactsData.results || [];
  const pipelines = pipelinesData.results || [];

  // Build stage label map from pipelines
  const stageMap = {};
  pipelines.forEach(p => {
    (p.stages || []).forEach(s => {
      stageMap[s.id] = { label: s.label, displayOrder: s.displayOrder, pipelineId: p.id, pipelineLabel: p.label };
    });
  });

  // Aggregate deals by stage
  const dealsByStage = {};
  let totalRevenue = 0;
  let totalDeals = deals.length;

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let dealsThisMonth = 0;
  let revenueThisMonth = 0;

  deals.forEach(d => {
    const props = d.properties || {};
    const stage = props.dealstage || 'unknown';
    const amount = parseFloat(props.amount) || 0;
    const created = new Date(props.createdate);

    if (!dealsByStage[stage]) {
      dealsByStage[stage] = { count: 0, amount: 0, label: stageMap[stage]?.label || stage };
    }
    dealsByStage[stage].count++;
    dealsByStage[stage].amount += amount;
    totalRevenue += amount;

    if (created >= thisMonth) {
      dealsThisMonth++;
      revenueThisMonth += amount;
    }
  });

  // Aggregate contacts by lifecycle
  const contactsByLifecycle = {};
  let contactsThisMonth = 0;

  contacts.forEach(c => {
    const props = c.properties || {};
    const lifecycle = props.lifecyclestage || 'unknown';
    const created = new Date(props.createdate);

    contactsByLifecycle[lifecycle] = (contactsByLifecycle[lifecycle] || 0) + 1;

    if (created >= thisMonth) contactsThisMonth++;
  });

  // Recent deals (last 5 modified)
  const recentDeals = [...deals]
    .sort((a, b) => new Date(b.properties?.hs_lastmodifieddate || 0) - new Date(a.properties?.hs_lastmodifieddate || 0))
    .slice(0, 5)
    .map(d => ({
      id: d.id,
      name: d.properties?.dealname || '',
      amount: parseFloat(d.properties?.amount) || 0,
      stage: stageMap[d.properties?.dealstage]?.label || d.properties?.dealstage || '',
      closedate: d.properties?.closedate || null,
      created: d.properties?.createdate || null,
    }));

  res.json({
    deals: {
      total: totalDeals,
      totalRevenue,
      dealsThisMonth,
      revenueThisMonth,
      byStage: dealsByStage,
      recent: recentDeals,
    },
    contacts: {
      total: contacts.length,
      contactsThisMonth,
      byLifecycle: contactsByLifecycle,
    },
    pipelines: pipelines.map(p => ({
      id: p.id,
      label: p.label,
      stages: (p.stages || []).map(s => ({ id: s.id, label: s.label, displayOrder: s.displayOrder })),
    })),
  });
});
