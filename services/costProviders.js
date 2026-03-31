/**
 * Cost Providers — Integración con APIs externas para obtener costos automáticamente
 * Cada provider tiene un método `fetchMonthlyCost(year, month)` que retorna un array de gastos.
 */
import axios from 'axios';

// ═══════════════════════════════════════════════════
// ANTHROPIC — Claude API Usage
// Usa: ANTHROPIC_ADMIN_API_KEY (con scope "usage" de admin)
// Docs: https://docs.anthropic.com/en/api/usage
// ═══════════════════════════════════════════════════
export const anthropicProvider = {
  name: 'Anthropic Claude API',
  category: 'claude_api',

  async fetchMonthlyCost(year, month) {
    const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
    const monthlyCostFallback = parseFloat(process.env.ANTHROPIC_MONTHLY_COST);
    const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;

    // Sin admin key → no se puede obtener uso real. El costo fijo mensual lo maneja anthropicSubscriptionProvider.
    if (!apiKey) {
      return { error: 'ANTHROPIC_ADMIN_API_KEY no configurada (el costo fijo se maneja por suscripción)', expenses: [] };
    }

    try {
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Anthropic Usage API — requiere admin key con scope "usage"
      const response = await axios.get('https://api.anthropic.com/v1/organizations/usage', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        params: {
          start_date: startStr,
          end_date: endStr,
        },
      });

      // Calcular costo total del response
      const data = response.data;
      let totalCost = 0;

      if (data.daily_usage) {
        data.daily_usage.forEach(day => {
          totalCost += (day.input_tokens_cost || 0) + (day.output_tokens_cost || 0);
        });
      } else if (data.total_cost !== undefined) {
        totalCost = data.total_cost;
      }

      // Convertir USD a MXN
      const totalMXN = Math.round(totalCost * usdToMxn * 100) / 100;

      return {
        expenses: [{
          category: 'claude_api',
          description: `Claude API usage — ${startStr} a ${endStr}`,
          amount: totalMXN,
          currency: 'MXN',
          date: endDate,
          source: 'api',
          isAutomatic: true,
          metadata: {
            originalCurrency: 'USD',
            originalAmount: Math.round(totalCost * 100) / 100,
            exchangeRate: usdToMxn,
            period: `${startStr} - ${endStr}`,
          },
        }],
      };
    } catch (error) {
      console.error('[CostProvider:Anthropic] Error:', error.response?.data || error.message);
      // No fallback aquí — el costo fijo lo maneja anthropicSubscriptionProvider
      return { error: `API falló: ${error.message}`, expenses: [] };
    }
  },
};

// ═══════════════════════════════════════════════════
// META — Facebook/Instagram Ads
// Usa: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
// Docs: https://developers.facebook.com/docs/marketing-api/insights
// ═══════════════════════════════════════════════════
export const metaAdsProvider = {
  name: 'Meta Ads',
  category: 'meta_ads',

  async fetchMonthlyCost(year, month) {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    if (!accessToken || !adAccountId) return { error: 'META_ACCESS_TOKEN o META_AD_ACCOUNT_ID no configuradas', expenses: [] };

    try {
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const response = await axios.get(
        `https://graph.facebook.com/v21.0/act_${adAccountId}/insights`,
        {
          params: {
            access_token: accessToken,
            time_range: JSON.stringify({ since: startStr, until: endStr }),
            fields: 'spend,impressions,clicks,actions',
            level: 'account',
          },
        }
      );

      const data = response.data?.data?.[0];
      if (!data) return { expenses: [], metadata: { message: 'No hay datos de gasto para este período' } };

      const spend = parseFloat(data.spend) || 0;
      // Meta reporta en la moneda de la cuenta (MXN para Tesipedia)

      return {
        expenses: [{
          category: 'meta_ads',
          description: `Meta Ads — ${startStr} a ${endStr} (${data.impressions || 0} impresiones, ${data.clicks || 0} clics)`,
          amount: spend,
          currency: 'MXN',
          date: endDate,
          source: 'api',
          isAutomatic: true,
          metadata: {
            impressions: parseInt(data.impressions) || 0,
            clicks: parseInt(data.clicks) || 0,
            spend: spend,
            period: `${startStr} - ${endStr}`,
            actions: data.actions || [],
          },
        }],
      };
    } catch (error) {
      const rawMsg = error.response?.data?.error?.message || error.message;
      const isExpired = rawMsg.toLowerCase().includes('session has expired') || rawMsg.toLowerCase().includes('access token');
      const friendlyMsg = isExpired
        ? 'Token de Meta expirado. Genera uno nuevo en Meta Business → Usuarios del sistema → Generar token.'
        : rawMsg;
      console.error('[CostProvider:MetaAds] Error:', friendlyMsg);
      return { error: friendlyMsg, expenses: [] };
    }
  },
};

// ═══════════════════════════════════════════════════
// GOOGLE ADS — Campañas de Google
// Usa: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//      GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID
// ═══════════════════════════════════════════════════
export const googleAdsProvider = {
  name: 'Google Ads',
  category: 'google_ads',

  async fetchMonthlyCost(year, month) {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

    if (!developerToken || !customerId) {
      return { error: 'Google Ads credentials no configuradas', expenses: [] };
    }

    try {
      // 1. Obtener access token via refresh token
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
      const accessToken = tokenRes.data.access_token;

      // 2. Query Google Ads API para gasto del mes
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const query = `
        SELECT metrics.cost_micros, metrics.impressions, metrics.clicks
        FROM customer
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      `;

      const customIdClean = customerId.replace(/-/g, '');
      const response = await axios.post(
        `https://googleads.googleapis.com/v18/customers/${customIdClean}/googleAds:searchStream`,
        { query },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'Content-Type': 'application/json',
          },
        }
      );

      let totalCostMicros = 0;
      let impressions = 0;
      let clicks = 0;

      (response.data || []).forEach(batch => {
        (batch.results || []).forEach(row => {
          totalCostMicros += parseInt(row.metrics?.costMicros || 0);
          impressions += parseInt(row.metrics?.impressions || 0);
          clicks += parseInt(row.metrics?.clicks || 0);
        });
      });

      // cost_micros está en micros de la moneda de la cuenta (MXN)
      const spend = totalCostMicros / 1_000_000;

      if (spend === 0) return { expenses: [], metadata: { message: 'Sin gasto en Google Ads este período' } };

      return {
        expenses: [{
          category: 'google_ads',
          description: `Google Ads — ${startDate} a ${endDate} (${impressions} impresiones, ${clicks} clics)`,
          amount: Math.round(spend * 100) / 100,
          currency: 'MXN',
          date: new Date(year, month + 1, 0),
          source: 'api',
          isAutomatic: true,
          metadata: { impressions, clicks, spend, costMicros: totalCostMicros },
        }],
      };
    } catch (error) {
      console.error('[CostProvider:GoogleAds] Error:', error.response?.data || error.message);
      return { error: error.message, expenses: [] };
    }
  },
};

// ═══════════════════════════════════════════════════
// NETLIFY — Hosting Frontend
// Usa: NETLIFY_ACCESS_TOKEN
// Costo fijo mensual del plan
// ═══════════════════════════════════════════════════
export const netlifyProvider = {
  name: 'Netlify',
  category: 'netlify',

  async fetchMonthlyCost(year, month) {
    const token = process.env.NETLIFY_ACCESS_TOKEN;
    const monthlyPlanCost = parseFloat(process.env.NETLIFY_MONTHLY_COST) || 9; // USD

    // Si hay token, verificar el plan actual
    if (token) {
      try {
        const response = await axios.get('https://api.netlify.com/api/v1/accounts', {
          headers: { Authorization: `Bearer ${token}` },
        });

        const account = response.data?.[0];
        const planType = account?.type_name || 'Personal';
        const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;

        return {
          expenses: [{
            category: 'netlify',
            description: `Netlify — Plan ${planType} (${new Date(year, month).toLocaleString('es-MX', { month: 'long', year: 'numeric' })})`,
            amount: Math.round(monthlyPlanCost * usdToMxn * 100) / 100,
            currency: 'MXN',
            date: new Date(year, month, 15),
            source: 'api',
            isAutomatic: true,
            isRecurring: true,
            recurringInterval: 'monthly',
            metadata: {
              originalCurrency: 'USD',
              originalAmount: monthlyPlanCost,
              exchangeRate: usdToMxn,
              planType,
            },
          }],
        };
      } catch (error) {
        console.error('[CostProvider:Netlify] Error:', error.message);
      }
    }

    // Fallback: costo fijo conocido
    const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;
    return {
      expenses: [{
        category: 'netlify',
        description: `Netlify — Plan Personal (${new Date(year, month).toLocaleString('es-MX', { month: 'long', year: 'numeric' })})`,
        amount: Math.round(monthlyPlanCost * usdToMxn * 100) / 100,
        currency: 'MXN',
        date: new Date(year, month, 15),
        source: 'api',
        isAutomatic: true,
        isRecurring: true,
        recurringInterval: 'monthly',
        metadata: { originalCurrency: 'USD', originalAmount: monthlyPlanCost, exchangeRate: usdToMxn },
      }],
    };
  },
};

// ═══════════════════════════════════════════════════
// RAILWAY — Hosting Backend
// Usa: RAILWAY_API_TOKEN
// Docs: https://docs.railway.com/reference/public-api
// ═══════════════════════════════════════════════════
export const railwayProvider = {
  name: 'Railway',
  category: 'railway',

  async fetchMonthlyCost(year, month) {
    const token = process.env.RAILWAY_API_TOKEN;
    if (!token) {
      // Fallback: usar costo base del plan Pro
      const planCost = parseFloat(process.env.RAILWAY_MONTHLY_COST) || 20;
      const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;
      return {
        expenses: [{
          category: 'railway',
          description: `Railway — Plan Pro (${new Date(year, month).toLocaleString('es-MX', { month: 'long', year: 'numeric' })})`,
          amount: Math.round(planCost * usdToMxn * 100) / 100,
          currency: 'MXN',
          date: new Date(year, month, 16),
          source: 'calculated',
          isAutomatic: true,
          isRecurring: true,
          recurringInterval: 'monthly',
          metadata: { originalCurrency: 'USD', originalAmount: planCost, exchangeRate: usdToMxn },
        }],
      };
    }

    try {
      // Railway usa GraphQL
      const query = `
        query {
          me {
            workspaces {
              edges {
                node {
                  id
                  name
                  usage(date: { year: ${year}, month: ${month + 1} }) {
                    totalCost
                    planCost
                    estimatedTotalCost
                  }
                }
              }
            }
          }
        }
      `;

      const response = await axios.post(
        'https://backboard.railway.com/graphql/v2',
        { query },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const workspaces = response.data?.data?.me?.workspaces?.edges || [];
      const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;
      const expenses = [];

      for (const { node } of workspaces) {
        const usage = node.usage;
        if (!usage) continue;

        const totalCost = usage.totalCost || usage.planCost || 0;
        expenses.push({
          category: 'railway',
          description: `Railway — ${node.name} (${new Date(year, month).toLocaleString('es-MX', { month: 'long', year: 'numeric' })})`,
          amount: Math.round(totalCost * usdToMxn * 100) / 100,
          currency: 'MXN',
          date: new Date(year, month, 16),
          source: 'api',
          isAutomatic: true,
          isRecurring: true,
          recurringInterval: 'monthly',
          metadata: {
            originalCurrency: 'USD',
            originalAmount: totalCost,
            exchangeRate: usdToMxn,
            workspaceName: node.name,
            estimatedTotal: usage.estimatedTotalCost,
          },
        });
      }

      return { expenses };
    } catch (error) {
      console.error('[CostProvider:Railway] Error:', error.response?.data || error.message);
      return { error: error.message, expenses: [] };
    }
  },
};

// ═══════════════════════════════════════════════════
// SUSCRIPCIÓN ANTHROPIC — Costo fijo mensual ($200 USD)
// ═══════════════════════════════════════════════════
export const anthropicSubscriptionProvider = {
  name: 'Suscripción Anthropic',
  category: 'claude_api',

  async fetchMonthlyCost(year, month) {
    const monthlyCost = parseFloat(process.env.ANTHROPIC_SUBSCRIPTION_COST) || 200;
    const usdToMxn = parseFloat(process.env.USD_TO_MXN_RATE) || 20.5;

    return {
      expenses: [{
        category: 'claude_api',
        description: `Suscripción Anthropic — ${new Date(year, month).toLocaleString('es-MX', { month: 'long', year: 'numeric' })}`,
        amount: Math.round(monthlyCost * usdToMxn * 100) / 100,
        currency: 'MXN',
        date: new Date(year, month, 1),
        source: 'calculated',
        isAutomatic: true,
        isRecurring: true,
        recurringInterval: 'monthly',
        metadata: { originalCurrency: 'USD', originalAmount: monthlyCost, exchangeRate: usdToMxn, type: 'subscription' },
      }],
    };
  },
};

// ═══════════════════════════════════════════════════
// CAMPAIGN-LEVEL FETCHING — Para ver campañas individuales en tiempo real
// ═══════════════════════════════════════════════════

export async function fetchMetaCampaigns(year, month) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!accessToken || !adAccountId) return { error: 'META_ACCESS_TOKEN o META_AD_ACCOUNT_ID no configuradas', campaigns: [] };

  try {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Fetch campaign-level insights
    const response = await axios.get(
      `https://graph.facebook.com/v21.0/act_${adAccountId}/insights`,
      {
        params: {
          access_token: accessToken,
          time_range: JSON.stringify({ since: startStr, until: endStr }),
          fields: 'campaign_name,campaign_id,spend,impressions,clicks,actions,reach,cpc,cpm,ctr,objective',
          level: 'campaign',
          limit: 100,
          sort: ['spend_descending'],
        },
      }
    );

    const campaigns = (response.data?.data || []).map(row => {
      const conversions = (row.actions || []).find(a => a.action_type === 'offsite_conversion.fb_pixel_lead' || a.action_type === 'lead');
      return {
        id: row.campaign_id,
        name: row.campaign_name || 'Sin nombre',
        platform: 'meta',
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        reach: parseInt(row.reach) || 0,
        cpc: parseFloat(row.cpc) || 0,
        cpm: parseFloat(row.cpm) || 0,
        ctr: parseFloat(row.ctr) || 0,
        objective: row.objective || '',
        conversions: conversions ? parseInt(conversions.value) : 0,
        currency: 'MXN',
        period: `${startStr} - ${endStr}`,
      };
    });

    return { campaigns };
  } catch (error) {
    const rawMsg = error.response?.data?.error?.message || error.message;
    const isExpired = rawMsg.toLowerCase().includes('session has expired') || rawMsg.toLowerCase().includes('access token');
    const friendlyMsg = isExpired
      ? 'Token de Meta expirado. Genera uno nuevo en Meta Business → Usuarios del sistema → Generar token.'
      : rawMsg;
    console.error('[Campaigns:Meta] Error:', friendlyMsg);
    return { error: friendlyMsg, campaigns: [] };
  }
}

export async function fetchGoogleAdsCampaigns(year, month) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

  if (!developerToken || !customerId) {
    return { error: 'Google Ads credentials no configuradas', campaigns: [] };
  }

  try {
    // 1. Get access token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const accessToken = tokenRes.data.access_token;

    // 2. Query campaign-level data
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const query = `
      SELECT campaign.id, campaign.name, campaign.status,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.average_cpc, metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
    `;

    const customIdClean = customerId.replace(/-/g, '');
    const response = await axios.post(
      `https://googleads.googleapis.com/v18/customers/${customIdClean}/googleAds:searchStream`,
      { query },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': developerToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const campaigns = [];
    (response.data || []).forEach(batch => {
      (batch.results || []).forEach(row => {
        const costMicros = parseInt(row.metrics?.costMicros || 0);
        campaigns.push({
          id: row.campaign?.id || '',
          name: row.campaign?.name || 'Sin nombre',
          platform: 'google',
          status: row.campaign?.status || '',
          spend: costMicros / 1_000_000,
          impressions: parseInt(row.metrics?.impressions || 0),
          clicks: parseInt(row.metrics?.clicks || 0),
          conversions: parseFloat(row.metrics?.conversions || 0),
          cpc: parseInt(row.metrics?.averageCpc || 0) / 1_000_000,
          ctr: parseFloat(row.metrics?.ctr || 0) * 100,
          currency: 'MXN',
          period: `${startDate} - ${endDate}`,
        });
      });
    });

    return { campaigns };
  } catch (error) {
    console.error('[Campaigns:Google] Error:', error.response?.data || error.message);
    return { error: error.message, campaigns: [] };
  }
}

export async function fetchAllCampaigns(year, month) {
  const [meta, google] = await Promise.all([
    fetchMetaCampaigns(year, month),
    fetchGoogleAdsCampaigns(year, month),
  ]);

  const campaigns = [...(meta.campaigns || []), ...(google.campaigns || [])];
  const errors = [];
  if (meta.error) errors.push({ provider: 'Meta Ads', error: meta.error });
  if (google.error) errors.push({ provider: 'Google Ads', error: google.error });

  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);

  return {
    campaigns: campaigns.sort((a, b) => b.spend - a.spend),
    totalSpend: Math.round(totalSpend * 100) / 100,
    errors,
    summary: {
      meta: { count: (meta.campaigns || []).length, spend: (meta.campaigns || []).reduce((s, c) => s + c.spend, 0) },
      google: { count: (google.campaigns || []).length, spend: (google.campaigns || []).reduce((s, c) => s + c.spend, 0) },
    },
  };
}

// ═══════════════════════════════════════════════════
// ALL PROVIDERS — fetch all at once
// ═══════════════════════════════════════════════════
export const allProviders = [
  anthropicProvider,
  anthropicSubscriptionProvider,
  metaAdsProvider,
  googleAdsProvider,
  netlifyProvider,
  railwayProvider,
];

export async function fetchAllProviderCosts(year, month) {
  const results = {};
  const allExpenses = [];
  const errors = [];

  for (const provider of allProviders) {
    try {
      const result = await provider.fetchMonthlyCost(year, month);
      results[provider.name] = result;

      if (result.error) {
        errors.push({ provider: provider.name, error: result.error });
      }
      if (result.expenses?.length) {
        allExpenses.push(...result.expenses);
      }
    } catch (err) {
      errors.push({ provider: provider.name, error: err.message });
    }
  }

  return { expenses: allExpenses, errors, providerResults: results };
}
