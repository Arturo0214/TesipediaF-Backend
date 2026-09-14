#!/usr/bin/env node
// FASE 1 — Genera el contenido de las piezas de redes de Tesipedia usando TU cuenta de
// ChatGPT en el navegador (no lo genera Claude, no gasta tokens de API). Se conecta a tu
// Chrome real por el puerto de depuración, manda 1 prompt con los slots pendientes, extrae
// el JSON, lo VALIDA y renderiza las tarjetas a /tmp/redes-lote/ para que las revises.
// NO escribe en la BD ni sube a Cloudinary (eso es la Fase 2, tras tu OK).
//
// REQUISITO (una vez): abre Chrome logueado en chatgpt.com con el puerto de depuración:
//   1) Cierra Chrome por completo.
//   2) /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//        --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-redes"
//   3) En esa ventana, inicia sesión en https://chatgpt.com  (solo la 1ª vez).
//
// Uso:
//   node scripts/generarRedesChatGPT.mjs --dias 3        # próximos 3 días de slots vacíos
//   node scripts/generarRedesChatGPT.mjs --limit 6       # los próximos 6 slots vacíos
//   node scripts/generarRedesChatGPT.mjs --limit 6 --dry # arma el prompt y NO abre el navegador
import 'dotenv/config';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { construirPrompt, validarPieza } from './lib/redesPrompt.mjs';
import { renderPieza } from './lib/redesRender.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DIAS = parseInt(arg('--dias', '0'), 10);
const LIMIT = parseInt(arg('--limit', '6'), 10);
const DRY = process.argv.includes('--dry');
const CDP = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const OUT = '/tmp/redes-lote';
const MARCA = 'Tesipedia';
const FORMATOS = ['FRASE', 'DICCIONARIO', 'CHECKLIST', 'COMPARATIVA', 'PRUEBA', 'OFERTA', 'CARRUSEL'];

// ── Supabase REST (mismo patrón que generarNoticias.mjs) ──
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };

async function slotsPendientes() {
  const desde = arg('--desde', new Date().toISOString().slice(0, 10)); // YYYY-MM-DD (default hoy)
  let f = `${SB}/rest/v1/contenido_social?select=id,dia,slot,fecha,formato,tema,pilar,titular,imagenes`
    + `&marca=eq.${MARCA}&fecha=gte.${desde}`
    + `&formato=in.(${FORMATOS.join(',')})`
    + `&order=fecha.asc,slot.asc`;
  if (DIAS > 0) {
    const hasta = new Date(new Date(`${desde}T00:00:00Z`).getTime() + DIAS * 864e5).toISOString().slice(0, 10);
    f += `&fecha=lte.${hasta}`;
  }
  const r = await fetch(f, { headers: sbHeaders });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || JSON.stringify(d));
  // SEGURIDAD: pendiente = SOLO si NO tiene imagen. Nunca sobrescribir un slot con imagen
  // (los posts basados en imagen tienen titular vacío a propósito).
  const pend = d.filter((s) => !Array.isArray(s.imagenes) || s.imagenes.length === 0);
  return DIAS > 0 ? pend : pend.slice(0, LIMIT);
}

// Repara los 2 defectos típicos de ChatGPT: saltos de línea reales dentro de strings y
// comillas dobles internas sin escapar. Recorre carácter a carácter con una máquina de estados.
function repararJSON(s) {
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr && c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; } // preserva escapes
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue; }
      // ¿comilla de cierre? el próximo no-espacio debe ser } ] : o una , seguida de " } ]
      let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;
      const nx = s[j];
      let cierra;
      if (nx === undefined || nx === '}' || nx === ']' || nx === ':') cierra = true;
      else if (nx === ',') { let k = j + 1; while (k < s.length && /\s/.test(s[k])) k++; const nn = s[k]; cierra = nn === undefined || nn === '"' || nn === '}' || nn === ']'; }
      else cierra = false;
      if (cierra) { inStr = false; out += c; }
      else out += '\\"'; // comilla interna → escapar
      continue;
    }
    if (inStr && (c === '\n' || c === '\r')) { out += '\\n'; continue; } // salto crudo → \n
    out += c;
  }
  return out;
}

// ── Extraer JSON del texto que devuelve ChatGPT (con reparación tolerante) ──
function extraerJSON(txt) {
  let s = txt;
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a > -1 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return JSON.parse(repararJSON(s)); }
}

// <br> (y saltos crudos) → salto de línea real, para titular y láminas
const nl = (v) => String(v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n');

// ── Driver de ChatGPT en el navegador (tu sesión real vía CDP) ──
async function preguntarChatGPT(prompt) {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  try {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const box = page.locator('#prompt-textarea');
    await box.waitFor({ state: 'visible', timeout: 60000 });
    await box.click();
    // Escribe el prompt (fillText en contenteditable ProseMirror)
    await page.evaluate((t) => navigator.clipboard.writeText(t), prompt).catch(() => {});
    await box.fill(prompt).catch(async () => { await page.keyboard.insertText(prompt); });
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');

    // Espera a que aparezca una respuesta del asistente y luego a que DEJE de crecer
    // (streaming terminado). Más robusto que depender de un data-testid concreto.
    const msgs = page.locator('[data-message-author-role="assistant"]');
    await msgs.first().waitFor({ state: 'visible', timeout: 60000 });
    let prev = '', estable = 0;
    const tope = Date.now() + 240000;
    while (Date.now() < tope) {
      await page.waitForTimeout(1800);
      const n = await msgs.count();
      const cur = n ? await msgs.nth(n - 1).innerText().catch(() => '') : '';
      if (cur && cur === prev) { if (++estable >= 2) break; } else { estable = 0; }
      prev = cur;
    }
    const n = await msgs.count();
    if (!n) throw new Error('ChatGPT no devolvió respuesta (¿sesión iniciada?).');
    return await msgs.nth(n - 1).innerText();
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const slots = await slotsPendientes();
  if (!slots.length) { console.log('✅ No hay slots pendientes en ese rango. Nada que generar.'); return; }
  console.log(`📋 ${slots.length} slots pendientes (${slots[0].fecha} → ${slots[slots.length - 1].fecha})`);
  const prompt = construirPrompt(slots);

  if (DRY) {
    rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/prompt.txt`, prompt);
    console.log(`📝 (DRY) prompt escrito en ${OUT}/prompt.txt · ${prompt.length} chars · NO se abrió el navegador.`);
    return;
  }

  console.log(`🌐 Conectando a Chrome (${CDP}) y preguntando a ChatGPT…`);
  const texto = await preguntarChatGPT(prompt);
  let arr;
  try { arr = extraerJSON(texto); }
  catch (e) {
    rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/respuesta_cruda.txt`, texto);
    throw new Error(`No pude parsear el JSON de ChatGPT (guardé la respuesta en ${OUT}/respuesta_cruda.txt): ${e.message}`);
  }

  // Validar + render
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  const porId = new Map(slots.map((s) => [String(s.id), s]));
  const lote = [];
  let okN = 0, bad = 0;
  for (const o of arr) {
    const slot = porId.get(String(o.id));
    if (!slot) { console.warn(`⚠️  id=${o.id} no coincide con ningún slot; lo omito.`); continue; }
    const { ok, err, pieza } = validarPieza(o, slot);
    pieza.titular = nl(pieza.titular);
    pieza.laminas = pieza.laminas.map(nl);
    if (!ok) { console.warn(`⚠️  id=${o.id} (${slot.formato}) con avisos: ${err.join('; ')}`); bad++; }
    const bufs = await renderPieza({ ...pieza, cta: pieza.cta });
    const imgs = [];
    bufs.forEach((b, i) => {
      const name = `${slot.formato}_${slot.id}${bufs.length > 1 ? '_' + (i + 1) : ''}.png`;
      writeFileSync(`${OUT}/${name}`, b); imgs.push(name);
    });
    lote.push({ ...pieza, dia: slot.dia, slot: slot.slot, fecha: slot.fecha, pilar: slot.pilar, archivos: imgs, avisos: err });
    okN++;
  }
  writeFileSync(`${OUT}/lote.json`, JSON.stringify(lote, null, 2));
  writeFileSync(`${OUT}/respuesta_cruda.txt`, texto);
  console.log(`\n✅ ${okN} piezas generadas y renderizadas en ${OUT}/ (${bad} con avisos).`);
  console.log(`   Revisa las imágenes y ${OUT}/lote.json. Cuando apruebes: node scripts/publicarLoteRedes.mjs`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
