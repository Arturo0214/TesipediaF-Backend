// scripts/refreshLookalikeSeed.js
// Loop de datos publicitarios (#1): cierra el ciclo re-generando la seed del
// lookalike a partir de TODOS los pagadores reales (no una foto estática).
// Cada mes que corre, Meta aprende mejor "quién paga tickets altos".
//
// Uso:
//   node scripts/refreshLookalikeSeed.js            → genera CSV local (seguro, solo lectura)
//   node scripts/refreshLookalikeSeed.js --push     → además sube a un Custom Audience de Meta
//                                                     (requiere META_CUSTOM_AUDIENCE_ID; acción externa)
import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
dotenv.config();

const PUSH = process.argv.includes('--push');
const OUT_DIR = path.join(os.homedir(), 'Desktop', 'Claude-Code');

// Normalización + hash SHA-256 al formato que exige Meta Custom Audiences
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = (e) => (e || '').trim().toLowerCase();
const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^0+/, '');
  // México: normalizar a E.164 sin '+': 52 + 10 dígitos
  if (d.length === 10) d = '52' + d;
  if (d.length === 11 && d.startsWith('1')) d = '52' + d.slice(1); // 1XXXXXXXXXX → 52…
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3); // 521XXXXXXXXXX → 52XXXXXXXXXX
  return d;
};

async function collectPayers() {
  const db = mongoose.connection.db;
  const [pays, quotes] = await Promise.all([
    db.collection('payments')
      .find({ status: 'completed' }, { projection: { clientPhone: 1, clientEmail: 1, clientName: 1, amount: 1 } })
      .toArray(),
    db.collection('generatedquotes')
      .find({ status: 'paid' }, { projection: { clientPhone: 1, clientEmail: 1, clientName: 1, precioConDescuento: 1 } })
      .toArray(),
  ]);

  const byKey = new Map(); // dedupe por teléfono normalizado (o email si no hay tel)
  const add = (phone, email, value) => {
    const p = normPhone(phone);
    const e = normEmail(email);
    if (!p && !e) return;
    const key = p || e;
    const prev = byKey.get(key);
    const val = Number(value) || 0;
    if (prev) { prev.value = Math.max(prev.value, val); return; }
    byKey.set(key, { phone: p, email: e, value: val });
  };

  for (const x of pays) add(x.clientPhone, x.clientEmail, x.amount);
  for (const q of quotes) add(q.clientPhone, q.clientEmail, q.precioConDescuento);

  return [...byKey.values()];
}

async function pushToMeta(payers) {
  const TOKEN = process.env.META_ACCESS_TOKEN;
  const AUDIENCE = process.env.META_CUSTOM_AUDIENCE_ID;
  if (!TOKEN) throw new Error('Falta META_ACCESS_TOKEN');
  if (!AUDIENCE) throw new Error('Falta META_CUSTOM_AUDIENCE_ID (crea el Custom Audience en Ads Manager y pon su ID)');

  // Meta espera cada campo hasheado, en el orden declarado por "schema"
  const schema = ['PHONE', 'EMAIL'];
  const data = payers
    .map((p) => [p.phone ? sha256(p.phone) : '', p.email ? sha256(p.email) : ''])
    .filter((row) => row[0] || row[1]);

  const url = `https://graph.facebook.com/v21.0/${AUDIENCE}/users`;
  let added = 0;
  for (let i = 0; i < data.length; i += 500) {
    const batch = data.slice(i, i + 500);
    const payload = { schema, data: batch };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, access_token: TOKEN }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    added += j.num_received || batch.length;
  }
  return added;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const payers = await collectPayers();

  const withPhone = payers.filter((p) => p.phone).length;
  const withEmail = payers.filter((p) => p.email).length;
  const highTicket = payers.filter((p) => p.value >= 8000).length;

  // CSV crudo (para subida manual en Ads Manager; Meta lo hashea al importar)
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(OUT_DIR, `lookalike-seed-${stamp}.csv`);
  const rows = ['phone,email', ...payers.map((p) => `${p.phone},${p.email}`)];
  fs.writeFileSync(file, rows.join('\n'));

  console.log(`Seed de pagadores: ${payers.length} únicos (${withPhone} con tel, ${withEmail} con email, ${highTicket} ticket ≥ $8k)`);
  console.log(`CSV para subida manual: ${file}`);

  if (PUSH) {
    console.log('Subiendo a Meta Custom Audience…');
    const added = await pushToMeta(payers);
    console.log(`✅ ${added} contactos enviados al Custom Audience ${process.env.META_CUSTOM_AUDIENCE_ID}`);
    console.log('   Luego en Ads Manager: crea/actualiza el Lookalike a partir de ese Custom Audience.');
  } else {
    console.log('(dry-run) No se subió nada a Meta. Corre con --push y META_CUSTOM_AUDIENCE_ID para enviar.');
  }

  await mongoose.disconnect();
}

run().catch((err) => { console.error('Error:', err.message); process.exit(1); });
