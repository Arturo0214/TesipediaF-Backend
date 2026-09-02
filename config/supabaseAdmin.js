// config/supabaseAdmin.js
// Cliente de Supabase con service_role para el Estudio de Contenido.
// El service_role salta RLS: solo debe vivir en el backend (nunca en el front).
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
// Reusa la var existente del backend (SUPABASE_SERVICE_KEY); acepta el nombre largo por si acaso.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!serviceKey) {
  console.warn('[supabaseAdmin] Falta SUPABASE_SERVICE_KEY: el Estudio de Contenido no podrá leer/escribir la cola.');
}

const supabaseAdmin = serviceKey
  ? createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node <22 no trae WebSocket nativo; el cliente realtime lo exige al construirse
    // aunque no lo usemos. Le damos 'ws' como transporte.
    realtime: { transport: ws },
  })
  : null;

export default supabaseAdmin;
