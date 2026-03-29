/**
 * Migración: Agregar columna 'origen' a la tabla leads en Supabase
 *
 * Ejecutar: node scripts/migrateAddOrigen.js
 *
 * Si falla (porque Supabase REST no permite DDL), copiar el SQL
 * y ejecutarlo manualmente en el SQL Editor de Supabase.
 */
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const headers = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const SQL = `
-- Agregar columna origen para trackear de dónde vino el lead
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origen text DEFAULT NULL;

-- Agregar columna manychat_segment para guardar el segmento original de ManyChat
ALTER TABLE leads ADD COLUMN IF NOT EXISTS manychat_segment text DEFAULT NULL;

-- Índice para filtrar por origen rápidamente
CREATE INDEX IF NOT EXISTS idx_leads_origen ON leads(origen);

-- Comentarios
COMMENT ON COLUMN leads.origen IS 'Fuente del lead: manychat, organico, web, referido, etc.';
COMMENT ON COLUMN leads.manychat_segment IS 'Segmento original de ManyChat: SUPER_HOT, HOT, WARM, TIBIO_1, TIBIO_2, FRIO, NEVER';
`;

async function runMigration() {
  console.log('🔄 Intentando ejecutar migración via Supabase RPC...\n');
  console.log('SQL a ejecutar:');
  console.log(SQL);

  try {
    // Intentar vía RPC (requiere que la función exec_sql exista o acceso SQL)
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: SQL }),
    });

    if (resp.ok) {
      console.log('\n✅ Migración ejecutada exitosamente via RPC');
      return;
    }

    const err = await resp.text();
    console.log(`\n⚠️  RPC no disponible (${resp.status}): ${err}`);
  } catch (e) {
    console.log(`\n⚠️  Error en RPC: ${e.message}`);
  }

  // Fallback: intentar vía el endpoint SQL directo de Supabase (solo disponible con service key)
  try {
    const resp = await fetch(`${SUPABASE_URL}/sql`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: SQL }),
    });

    if (resp.ok) {
      console.log('\n✅ Migración ejecutada exitosamente via /sql endpoint');
      return;
    }
  } catch {
    // ignore
  }

  console.log('\n' + '='.repeat(60));
  console.log('⚠️  No se pudo ejecutar automáticamente.');
  console.log('');
  console.log('POR FAVOR ejecuta este SQL manualmente en Supabase:');
  console.log('1. Ve a https://supabase.com/dashboard');
  console.log('2. Abre tu proyecto → SQL Editor');
  console.log('3. Pega y ejecuta el SQL de arriba');
  console.log('='.repeat(60));

  // Verificar si las columnas ya existen
  console.log('\n🔍 Verificando estado actual de la tabla...');
  try {
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?select=origen,manychat_segment&limit=1`,
      { headers }
    );
    if (checkResp.ok) {
      console.log('✅ Las columnas "origen" y "manychat_segment" YA EXISTEN en la tabla.');
      console.log('   No es necesario ejecutar la migración.');
    } else {
      const errText = await checkResp.text();
      if (errText.includes('origen') || errText.includes('manychat_segment')) {
        console.log('❌ Las columnas NO existen aún. Debes ejecutar el SQL.');
      } else {
        console.log('⚠️  No se pudo verificar. Error:', errText.substring(0, 200));
      }
    }
  } catch (e) {
    console.log('⚠️  No se pudo verificar:', e.message);
  }
}

runMigration().catch(console.error);
