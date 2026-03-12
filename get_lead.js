import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const supabaseHeaders = () => ({
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

async function run() {
  const getUrl = `${SUPABASE_URL}/rest/v1/leads?select=historial_chat&limit=1`;
  const getResponse = await fetch(getUrl, { headers: supabaseHeaders() });
  const leadData = await getResponse.json();
  console.log("LEAD DATA:", JSON.stringify(leadData, null, 2));
}
run();
