import asyncHandler from 'express-async-handler';

const HUBSPOT_BASE = 'https://api.hubapi.com';

const hubspotFetch = async (endpoint, params = {}) => {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN no configurado');

  const url = new URL(`${HUBSPOT_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      // HubSpot v3 API: properties must be comma-separated in a single param
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
  const { limit = 100, after } = req.query;

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
  // Fetch deals, contacts, and pipelines in parallel
  // Use Promise.allSettled so one failure doesn't block everything
  const [dealsResult, contactsResult, pipelinesResult] = await Promise.allSettled([
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

  const deals = dealsResult.status === 'fulfilled' ? (dealsResult.value.results || []) : [];
  const contacts = contactsResult.status === 'fulfilled' ? (contactsResult.value.results || []) : [];
  const pipelines = pipelinesResult.status === 'fulfilled' ? (pipelinesResult.value.results || []) : [];

  // Log errors for failed requests
  if (dealsResult.status === 'rejected') console.error('[HubSpot] Deals fetch failed:', dealsResult.reason?.message);
  if (contactsResult.status === 'rejected') console.error('[HubSpot] Contacts fetch failed:', contactsResult.reason?.message);
  if (pipelinesResult.status === 'rejected') console.error('[HubSpot] Pipelines fetch failed:', pipelinesResult.reason?.message);

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

  // Recent contacts (last 5 created)
  const recentContacts = [...contacts]
    .sort((a, b) => new Date(b.properties?.createdate || 0) - new Date(a.properties?.createdate || 0))
    .slice(0, 5)
    .map(c => ({
      id: c.id,
      name: `${c.properties?.firstname || ''} ${c.properties?.lastname || ''}`.trim() || c.properties?.email || 'Sin nombre',
      email: c.properties?.email || '',
      lifecycle: c.properties?.lifecyclestage || '',
      created: c.properties?.createdate || null,
    }));

  res.json({
    deals: {
      total: deals.length,
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
      recent: recentContacts,
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
