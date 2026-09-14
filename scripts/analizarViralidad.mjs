// Analiza el rendimiento REAL de FB/IG (Tesipedia y Contratado) usando el MISMO mecanismo que la
// sección Rendimiento del Estudio: lee el FEED propio de la página (reactions/comments/shares) y los
// campos básicos de IG media (like_count/comments_count) — que SÍ son accesibles sin el permiso
// read_insights. Los COMPARTIDOS (FB) son el mejor proxy de "sends" (la palanca de alcance frío).
// Vistas/alcance/retención requieren read_insights (bloqueado) → se intentan y se marcan si faltan.
//   node scripts/analizarViralidad.mjs [--marca Tesipedia|Contratado|ambas] [--n 50]
import 'dotenv/config';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const MARCA = arg('--marca', 'ambas');
const N = arg('--n', '50');
const GV = 'v21.0';

// Mismos IDs/token que el controller (con sus defaults) para que funcione aunque el .env no los traiga.
const BRAND = {
  Tesipedia: { pageId: process.env.FB_PAGE_ID || '855962324262046', igUserId: process.env.IG_USER_ID || '17841477846360365', userToken: process.env.META_ACCESS_TOKEN, pageToken: null },
  Contratado: { pageId: process.env.CONTRATADO_FB_PAGE_ID, igUserId: process.env.CONTRATADO_IG_USER_ID, userToken: process.env.META_ACCESS_TOKEN, pageToken: process.env.CONTRATADO_FB_PAGE_TOKEN },
};

async function graph(path, params, token) {
  const url = `https://graph.facebook.com/${GV}/${path}?${new URLSearchParams({ ...params, access_token: token })}`;
  const r = await fetch(url); const d = await r.json();
  if (d.error) throw new Error(`[${d.error.code}] ${d.error.message}`);
  return d;
}
async function pageToken(b) {
  if (b.pageToken) return b.pageToken;
  try { const d = await graph('me/accounts', {}, b.userToken); const pg = (d.data || []).find((p) => p.id === b.pageId); return pg?.access_token || b.userToken; }
  catch { return b.userToken; }
}
const has = (t) => /\?/.test(t);
const GANCHO = [/^\s*\d+[\s.)]/, /\bpov\b/i, /as[ií] no|as[ií] s[ií]/i, /deja de\b/i, /nadie te/i, /el (error|secreto)/i, /est[aá] mal/i];
const emojis = (t) => (String(t).match(/\p{Extended_Pictographic}/gu) || []).length;

// engagement score: comparte pesa más (proxy de send), luego comentario, luego reacción.
const eng = (r) => (r.compartidos || 0) * 5 + (r.comentarios || 0) * 2 + (r.reacciones || 0) * 1;

async function analizar(nombre) {
  const b = BRAND[nombre];
  if (!b || (!b.pageId && !b.igUserId)) { console.log(`\n### ${nombre}: sin credenciales\n`); return []; }
  const tok = await pageToken(b);
  console.log(`\n${'='.repeat(72)}\n### ${nombre}  ·  FB ${b.pageId || '—'}  ·  IG ${b.igUserId || '—'}\n${'='.repeat(72)}`);
  const rows = [];

  // FB: una sola llamada al feed con engagement (como Rendimiento). tipo desde attachments.
  if (b.pageId) {
    try {
      const feed = await graph(`${b.pageId}/posts`, { fields: 'id,created_time,message,permalink_url,attachments{media_type,title},reactions.summary(true),comments.summary(true),shares', limit: N }, tok);
      for (const p of feed.data || []) {
        const mt = p.attachments?.data?.[0]?.media_type || 'status';
        rows.push({ red: 'FB', tipo: /video|reel/i.test(mt) ? 'reel' : mt, fecha: p.created_time?.slice(0, 10), texto: (p.message || '').replace(/\n/g, ' ').slice(0, 70),
          reacciones: p.reactions?.summary?.total_count || 0, comentarios: p.comments?.summary?.total_count || 0, compartidos: p.shares?.count || 0, caplen: (p.message || '').length, preg: has(p.message || ''), link: p.permalink_url });
      }
    } catch (e) { console.log('  ⚠ FB feed:', e.message); }
  }
  // IG: media con campos básicos (sin /insights). intenta plays por reel.
  if (b.igUserId) {
    try {
      const media = await graph(`${b.igUserId}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: N }, tok);
      for (const m of media.data || []) {
        const row = { red: 'IG', tipo: m.media_product_type === 'REELS' ? 'reel' : (m.media_type || 'post').toLowerCase(), fecha: m.timestamp?.slice(0, 10), texto: (m.caption || '').replace(/\n/g, ' ').slice(0, 70),
          reacciones: m.like_count || 0, comentarios: m.comments_count || 0, compartidos: 0, caplen: (m.caption || '').length, preg: has(m.caption || ''), vistas: null, link: m.permalink };
        try { const ins = await graph(`${m.id}/insights`, { metric: 'plays' }, tok); row.vistas = ins.data?.[0]?.values?.[0]?.value ?? null; } catch { /* sin read_insights */ }
        rows.push(row);
      }
    } catch (e) { console.log('  ⚠ IG media:', e.message); }
  }

  rows.forEach((r) => { r.eng = eng(r); });
  rows.sort((a, x) => x.eng - a.eng);
  const conVistas = rows.filter((r) => r.vistas != null);
  console.log(`\n${rows.length} publicaciones · vistas disponibles en ${conVistas.length} (resto: falta read_insights)\n`);
  console.log('TOP por engagement (compartir×5 + comentario×2 + reacción):');
  for (const r of rows.slice(0, 12)) {
    console.log(`  eng ${String(r.eng).padStart(4)} · ${String(r.reacciones).padStart(4)}❤ ${String(r.comentarios).padStart(3)}💬 ${String(r.compartidos).padStart(3)}↗ · ${r.red}/${r.tipo.padEnd(7)} · ${r.fecha} · ${r.texto}`);
  }
  rows.forEach((r) => { r.marca = nombre; });
  return rows;
}

function patrones(rows) {
  const conEng = rows.filter((r) => r.eng > 0);
  if (conEng.length < 4) { console.log('\n(Pocos datos con engagement para inferir patrones — cuentas muy nuevas.)'); return; }
  conEng.sort((a, x) => x.eng - a.eng);
  const n = Math.max(2, Math.floor(conEng.length / 3));
  const top = conEng.slice(0, n), bottom = conEng.slice(-n);
  const prom = (a, k) => +(a.reduce((s, r) => s + (r[k] || 0), 0) / a.length).toFixed(1);
  const share = (a, pred) => Math.round(100 * a.filter(pred).length / a.length);
  console.log(`\n${'='.repeat(72)}\n### PATRONES: top ${n} vs bottom ${n} (por engagement)`);
  console.log(`  % reels          → top ${share(top, (r) => r.tipo === 'reel')}%   vs bottom ${share(bottom, (r) => r.tipo === 'reel')}%`);
  console.log(`  compartidos prom → top ${prom(top, 'compartidos')}    vs bottom ${prom(bottom, 'compartidos')}`);
  console.log(`  comentarios prom → top ${prom(top, 'comentarios')}    vs bottom ${prom(bottom, 'comentarios')}`);
  console.log(`  long. caption    → top ${prom(top, 'caplen')}   vs bottom ${prom(bottom, 'caplen')}`);
  console.log(`  % con pregunta   → top ${share(top, (r) => r.preg)}%   vs bottom ${share(bottom, (r) => r.preg)}%`);
  console.log(`  gancho-afirmación en 1ª línea → top ${share(top, (r) => GANCHO.some((g) => g.test(r.texto)))}%   vs bottom ${share(bottom, (r) => GANCHO.some((g) => g.test(r.texto)))}%`);
}

async function main() {
  console.log(`🔎 Viralidad REAL (Graph ${GV}, sin /insights donde está bloqueado) · ${N} por cuenta`);
  const marcas = MARCA === 'ambas' ? ['Tesipedia', 'Contratado'] : [MARCA];
  const all = [];
  for (const m of marcas) all.push(...await analizar(m));
  patrones(all);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
