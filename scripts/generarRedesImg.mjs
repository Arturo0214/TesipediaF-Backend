#!/usr/bin/env node
// Genera el CONTENIDO VISUAL de las piezas de redes de Tesipedia usando la generación de
// imágenes de TU ChatGPT en el navegador (estilo real: 9:16 oscuro, foto/meme, logo oficial,
// slogan "tu tesis, más fácil", anotaciones). Descarga la(s) imagen(es), extrae pie de foto +
// hashtags y las sube como BORRADOR a los slots. NO gasta tokens de API.
//
// Requiere Chrome con puerto debug (ver generarRedesChatGPT.mjs) y sesión en chatgpt.com.
//   node scripts/generarRedesImg.mjs --desde 2026-09-23 --dias 14   # 2 semanas
//   node scripts/generarRedesImg.mjs --desde 2026-09-23 --limit 1   # prueba 1 slot
//   ... --dry   → arma prompts, no abre navegador ni sube
import 'dotenv/config';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import pkg from 'playwright-core';
const { chromium } = pkg;
import { v2 as cloudinary } from 'cloudinary';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DESDE = arg('--desde', new Date().toISOString().slice(0, 10));
const DIAS = parseInt(arg('--dias', '0'), 10);
const LIMIT = parseInt(arg('--limit', '1'), 10);
const PAUSA = parseInt(arg('--pausa', '30'), 10) * 1000; // pausa entre piezas (seg) para no atosigar a ChatGPT
const TURNO = parseInt(arg('--turno', '25'), 10) * 1000; // pausa entre turnos/imágenes (seg)
const PORCHAT = parseInt(arg('--porchat', '6'), 10); // piezas por chat antes de abrir uno nuevo
const DRY = process.argv.includes('--dry');
const CDP = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const OUT = '/tmp/redes-img';
const MARCA = arg('--marca', 'Tesipedia');
// Carga el banco de temas + identidad según la marca.
const TEMAS_MOD = await import(MARCA === 'Contratado' ? './lib/temasContratado.mjs' : './lib/temasRedes.mjs');
const { CARRUSEL_TEMAS, MARCA_CFG } = TEMAS_MOD;
const PRODUCTOS = TEMAS_MOD.PRODUCTOS || null; // catálogo de productos reales (Contratado) para las OFERTA
const LOGO = MARCA_CFG.logo;
// Ofertas de Tesipedia = la PORTADA REAL de una guía adjuntada a ChatGPT (él la estiliza).
let GUIAS_OFERTA = null, GO = 0, PO = 0;
if (MARCA === 'Tesipedia') {
  try {
    const { GUIAS_DATA } = await import('../config/guiasData.js');
    const ga = (await import('../config/guiasAssets.json', { with: { type: 'json' } })).default;
    GUIAS_OFERTA = GUIAS_DATA.map((g) => ({ id: g.id, nombre: g.kicker, precio: g.precio, resumen: g.resumen, cover: ga[g.id]?.pages?.[0] })).filter((g) => g.cover);
  } catch (e) { console.warn('⚠ no cargué guías para ofertas:', e.message); }
}
const FORMATOS = ['FRASE', 'DICCIONARIO', 'CHECKLIST', 'COMPARATIVA', 'PRUEBA', 'OFERTA', 'CARRUSEL', 'VACANTE'];

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET, secure: true,
});
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbH = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };

async function slotsPendientes() {
  let f = `${SB}/rest/v1/contenido_social?select=id,dia,slot,fecha,formato,tema,pilar,titular,imagenes`
    + `&marca=eq.${MARCA}&fecha=gte.${DESDE}&formato=in.(${FORMATOS.join(',')})&order=fecha.asc,slot.asc`;
  if (DIAS > 0) f += `&fecha=lte.${new Date(new Date(`${DESDE}T00:00:00Z`).getTime() + DIAS * 864e5).toISOString().slice(0, 10)}`;
  const r = await fetch(f, { headers: sbH }); const d = await r.json();
  if (!r.ok) throw new Error(d.message || JSON.stringify(d));
  // SEGURIDAD: pendiente = SOLO si NO tiene imagen. Nunca tocar un slot que ya tiene imagen
  // (los posts basados en imagen tienen titular vacío a propósito → jamás usar titular como señal).
  const pend = d.filter((s) => !Array.isArray(s.imagenes) || s.imagenes.length === 0);
  return DIAS > 0 ? pend : pend.slice(0, LIMIT);
}
async function sbUpdate(id, fila) {
  const r = await fetch(`${SB}/rest/v1/contenido_social?id=eq.${id}`, { method: 'PATCH', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(fila) });
  const d = await r.json(); if (!r.ok) throw new Error(d.message || JSON.stringify(d)); return d;
}

// ── Estilo de marca (preámbulo común para cada imagen) ──
const ESTILO = `Eres director creativo de contenido viral para Instagram de ${MARCA_CFG.nombre}.
CALIDAD: tipografía grande y MUY legible; contenido que ENSEÑA algo concreto y accionable (con ejemplos y datos), no relleno. Colores de marca: ${MARCA_CFG.colores}. Voz: ${MARCA_CFG.voz}.
MÁRGENES SEGUROS: deja aire arriba y abajo; el logo (arriba) y el CTA (abajo) NUNCA pegados al borde, para que no se corten al recortar el feed.
LOGO: usa EXACTAMENTE el logo que te adjunto (logo OFICIAL de ${MARCA_CFG.nombre}); si es solo el isotipo, escribe también el wordmark "${MARCA_CFG.nombre}" junto a él en el estilo de la marca. NO inventes otro logo.
SLOGAN: incluye "${MARCA_CFG.slogan}" cerca del logo. Handle pequeño: ${MARCA_CFG.handle}.`;

// Rotación de VARIEDAD: cada pieza usa una escena/persona/estilo distinto para no repetir.
const ESCENAS = [
  'un MEME estilo reacción con still tipo película/serie y expresión exagerada (humor, formato meme viral)',
  'un estudiante hombre joven con audífonos, concentrado, de día',
  'SIN personas: flat lay cenital de escritorio con laptop, café, libros y post-its',
  'un grupo de 2-3 amigos estudiando juntos en una mesa',
  'PÓSTER TIPOGRÁFICO: fondo de color de marca, la frase ENORME y una ilustración mínima (sin foto)',
  'una chica con lentes tomando notas en la biblioteca entre libreros',
  'un estudiante adulto/mayor (no tradicional) estudiando en casa',
  'primer plano de manos escribiendo en un cuaderno, café al lado (sin rostro)',
  'un chico latino en una cafetería con su laptop y un café',
  'SIN personas: un corcho/pizarra lleno de post-its con el esquema de la tesis',
  'un estudiante celebrando/aliviado frente a la computadora',
  'una estudiante mujer en su escritorio con laptop (fondo oscuro cálido)',
];
const LOOKS = ['foto realista cálida', 'estética de meme viral', 'flat lay cenital ordenado',
  'ilustración editorial plana y moderna', 'collage con recortes, washi tape y post-its', 'diseño tipográfico limpio'];
let VC = 0;
const POSES = ['celebrando el éxito con los brazos en alto', 'señalando a la cámara con actitud persuasiva',
  'en la oficina, seguro de sí mismo, con un CV o laptop', 'de traje, sonriendo con confianza y el pulgar arriba',
  'festejando una oferta de trabajo', 'explicando algo con seguridad frente a la cámara'];
// Escenas de empleo/RH para las marcas con personaje (Contratado) cuando NO toca la mascota.
// Muchas SIN personas / con hombre / grupo / ilustración para NO caer siempre en "mujer en laptop".
const ESCENAS_EMPLEO = [
  'SIN personas: flat lay cenital de un CV impreso, café, bolígrafo y clips sobre madera',
  'un hombre joven profesional revisando su CV en el celular en el transporte público',
  'SIN personas: solo el mockup de la app de Contratado en la pantalla de un teléfono',
  'un grupo diverso de 3 profesionales conversando en una sala de juntas luminosa',
  'un hombre mayor en reconversión laboral, seguro, trabajando en casa',
  'ILUSTRACIÓN plana estilo vector: una persona subiendo una escalera hecha de hojas de CV',
  'PÓSTER TIPOGRÁFICO sin personas: fondo azul marino, el dato/frase ENORME y un ícono lineal',
  'primer plano de dos manos entregando/recibiendo un CV en una entrevista (sin rostros)',
  'una reclutadora afrodescendiente sonriendo mientras revisa una tablet',
  'SIN personas: un tablero/corcho con vacantes, flechas y notas adhesivas de colores',
];
// Composición/estructura visual que ROTA por pieza: evita que dos piezas del mismo formato se vean iguales.
const DISENOS = [
  'split diagonal: zona superior roja (ASÍ NO) y zona inferior verde (ASÍ SÍ), SIN tabla de columnas',
  'dos tarjetas tipo pantalla de teléfono lado a lado (antes / después)',
  'estilo revista editorial: una foto grande a un lado y el texto en bloque tipográfico al otro',
  'PURO TIPOGRÁFICO sin foto: fondo de color de marca, texto enorme e íconos lineales grandes',
  'mockup de la pantalla del producto/app como elemento central y el texto alrededor',
  'infografía limpia con íconos circulares, numeritos grandes y mucho aire en blanco',
  'formato ticket/lista con casillas marcadas y sellos',
  'collage con recortes, flechas dibujadas a mano y notas adhesivas',
];
function variedad() {
  if (MARCA_CFG.personaje) {
    // La mascota (DiCaprio) SOLO ~1 de cada 7 piezas (2-3/semana), en contenido de alto valor.
    if (VC % 7 === 3) {
      const pose = POSES[Math.floor(VC / 7) % POSES.length]; VC++;
      return `\n\n(PIEZA DE ALTO VALOR) Incluye al PERSONAJE DE MARCA de Contratado: ${MARCA_CFG.personaje}. Aparece ${pose}. Intégralo bien, sin tapar el texto.`;
    }
    const e = ESCENAS_EMPLEO[VC % ESCENAS_EMPLEO.length];
    const dis = DISENOS[(VC * 3 + 1) % DISENOS.length];
    VC++;
    return `\n\nVARIEDAD OBLIGATORIA (que esta pieza NO se parezca a las anteriores):
- COMPOSICIÓN/LAYOUT: ${dis}. NO uses otra vez la típica tabla de dos columnas rojo/verde con foto en la esquina.
- ESCENA/SUJETO: ${e}. PROHIBIDO repetir "mujer con blazer en laptop/escritorio" (ya se usó de más): varía género, edad y tono de piel, y alterna con piezas SIN personas.
- Cambia paleta de acento, tipografía y disposición del texto respecto a piezas previas.`;
  }
  const e = ESCENAS[VC % ESCENAS.length];
  const l = LOOKS[(VC * 3 + 2) % LOOKS.length];
  const dis = DISENOS[(VC * 5 + 2) % DISENOS.length];
  VC++;
  return `\n\nVARIEDAD (obligatorio): que esta pieza NO se parezca a otras. Escena: ${e}. Estilo visual: ${l}. COMPOSICIÓN/LAYOUT: ${dis}. Cambia encuadre, paleta de acento y composición. Si hay personas, que sean DISTINTAS cada vez (varía género, edad, tono de piel, vestimenta); alterna con piezas SIN personas. Puedes usar o no anotaciones/sticky notes según el estilo.`;
}

// CARRUSEL_TEMAS viene de ./lib/temasRedes.mjs (banco compartido con el calendario).
let CC = 0;
const temaCarrusel = (tema) => CARRUSEL_TEMAS.find((x) => x.titulo === tema) || CARRUSEL_TEMAS[CC++ % CARRUSEL_TEMAS.length];

// Prompt por formato → { prompts:[...], assetUrl? }  (1 prompt = 1 imagen/turno; carrusel = varias)
function promptDe(s) {
  const t = s.tema || 'tesis';
  // OFERTA de Tesipedia = estiliza un post con la PORTADA REAL de una guía (se adjunta esa imagen).
  if (s.formato === 'OFERTA' && GUIAS_OFERTA?.length) {
    const g = GUIAS_OFERTA[GO++ % GUIAS_OFERTA.length];
    const prompt = `Eres director creativo de Tesipedia (asesoría de tesis en México; colores navy #071A3A + ámbar #F5B301). Crea UN post de OFERTA vertical 9:16 (1080x1920), estilizado y viral, para vender una guía.
USA EXACTAMENTE la imagen que te adjunto: es la PORTADA REAL de la guía "${g.nombre}". Colócala como elemento CENTRAL y destacado (con marco/sombra elegante), SIN alterarla ni recortar su texto.
Alrededor añade: un BADGE grande con el precio $${g.precio}; el título "${g.nombre}"; 2-3 bullets de valor; y un CTA claro "Consíguela en tesipedia.com/guias/${g.id}". Incluye el wordmark "Tesipedia", el slogan "tu tesis, más fácil" y @tesipediaoficial. Deja márgenes seguros (nada pegado al borde).`;
    return { prompts: [prompt], assetUrl: g.cover };
  }
  // OFERTA de Contratado = mockup del PRODUCTO REAL (analizador, plantillas, AdaptaCV, plan…) con su precio y URL.
  if (s.formato === 'OFERTA' && MARCA === 'Contratado' && PRODUCTOS?.length) {
    const p = PRODUCTOS[PO++ % PRODUCTOS.length];
    const prompt = `${ESTILO}\n\nCrea UN post de OFERTA vertical 9:16 (1080x1920), estilizado y viral, para promocionar un PRODUCTO REAL de Contratado.
PRODUCTO: "${p.nombre}" — ${p.promesa}. Precio/badge: ${p.badge} (muestra "${p.precio}" en grande y destacado).
ELEMENTO CENTRAL (obligatorio): ${p.visual}
Debajo/al lado añade: el nombre del producto, ${p.bullets.length} bullets de valor cortos (${p.bullets.map((b) => `«${b}»`).join(', ')}) y un CTA claro "${p.precio === 'GRATIS' ? 'Pruébalo GRATIS' : 'Consíguelo'} en ${p.url}".
Que se vea como un producto de software real y confiable (no clipart genérico). Deja márgenes seguros. SIN personas ni mascota: el producto es el protagonista.`;
    return { prompts: [prompt] };
  }
  if (s.formato === 'CARRUSEL') {
    const c = temaCarrusel(s.tema); // usa el tema del calendario si coincide; si no, rota
    const n = c.tips.length + 2; // portada + tips + cierre
    const comun = `${ESTILO}\n\nEstás haciendo un CARRUSEL EDUCATIVO de ${n} láminas para feed de Instagram sobre: "${c.titulo}". FORMATO 4:5 (1080x1350) en TODAS. Todas comparten la MISMA identidad visual (mismos colores, tipografía, logo arriba y slogan). Devuelve UNA sola imagen por turno, nunca un collage.${variedad()}`;
    const prompts = [`${comun}\n\nCrea SOLO la LÁMINA 1 (PORTADA): el título "${c.titulo}" en grande + un gancho corto que dé ganas de deslizar. Sin numerito de consejo (es portada).`];
    c.tips.forEach((tip, i) => prompts.push(`Ahora SOLO la LÁMINA ${i + 2} del mismo carrusel (misma identidad, logo, slogan, 4:5): muestra el número "${i + 1}" grande y el consejo: "${tip}". Añade un mini-ejemplo concreto. Una sola imagen, NO collage.`));
    prompts.push(`Ahora SOLO la LÁMINA ${n} (CIERRE) del mismo carrusel (4:5): "Guarda este carrusel 📌" + invita a ${c.guia} y a escribir por DM. Misma identidad. Una sola imagen.`);
    return { prompts };
  }
  const reglas = {
    FRASE: 'una FRASE/gancho relatable que ADEMÁS deje un mini-tip útil y concreto (con un mini-ejemplo). Texto principal corto y grande.',
    DICCIONARIO: 'estilo "diccionario": una palabra/término del tema + definición corta con humor que deja una verdad útil.',
    CHECKLIST: 'un CHECKLIST visual de 5 puntos concretos y accionables sobre el tema (con casillas). Cada punto específico, no genérico.',
    COMPARATIVA: 'una COMPARATIVA de 3-4 ejemplos concretos: lo que NO funciona vs lo que SÍ. Usa la COMPOSICIÓN indicada en la sección de variedad (NO siempre la tabla clásica de dos columnas rojo/verde).',
    PRUEBA: `un DATO/PRUEBA social creíble de ${MARCA_CFG.nombre}, sin inventar cifras exactas no verificables.`,
    OFERTA: 'una OFERTA clara del producto/servicio: qué recibe la persona, el precio si aplica y el CTA con el link.',
    VACANTE: 'un anuncio de VACANTE estilo AMARILLISTA (titular impactante tipo "¡X está contratando!", con el SUELDO y la DEPENDENCIA enormes) con datos reales. Incluye el LOGO/EMBLEMA OFICIAL de la dependencia de gobierno mencionada (renderízalo de forma destacada y creíble) y el emblema "Gobierno de México" si aplica; abajo un CTA claro para aplicar.',
  };
  const fmt = s.formato === 'VACANTE' ? 'imagen 4:5 (1080x1350, para feed)' : 'imagen vertical 9:16 (1080x1920, para historia/reel)';
  return { prompts: [`${ESTILO}\n\nTEMA: ${t}.\nCrea UNA ${fmt} con ${reglas[s.formato] || reglas.FRASE}${variedad()}`] };
}

// Envía texto en el composer y verifica que arrancó (reintenta). true si arrancó.
async function enviar(page, texto) {
  await page.bringToFront().catch(() => {}); // mantén la pestaña activa: evita que Chrome la descarte (Memory Saver) entre turnos
  const box = page.locator('#prompt-textarea:visible').first(); // a veces hay 2 composers; toma el visible
  await box.waitFor({ state: 'visible', timeout: 30000 });
  // Cierra dropdowns de sugerencias ("Busca en la web") o popups que interceptan el click del composer.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  // Espera a que termine cualquier generación en curso (el stop-button deshabilita/cubre el composer).
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-button"]'), null, { timeout: 20000 }).catch(() => {});
  // Click robusto: intento normal corto → scroll+focus vía JS → force.
  let enfocado = false;
  for (const intento of [0, 1, 2]) {
    try {
      if (intento === 0) { await box.click({ timeout: 6000 }); }
      else if (intento === 1) { await box.scrollIntoViewIfNeeded().catch(() => {}); await box.evaluate((el) => el.focus()); }
      else { await box.click({ timeout: 6000, force: true }); }
      enfocado = true; break;
    } catch { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(600); }
  }
  if (!enfocado) { console.log('    ⚠ no pude enfocar el composer'); return false; }
  await page.keyboard.insertText(texto);
  await page.waitForTimeout(900);
  const nAntes = await page.evaluate(() => document.querySelectorAll('[data-message-author-role="user"]').length).catch(() => 0);
  for (let intento = 0; intento < 3; intento++) {
    let clic = false;
    for (const sel of ['[data-testid="send-button"]', 'button[aria-label*="Enviar"]', 'button[aria-label*="Send"]']) {
      const btn = page.locator(sel).first();
      if (await btn.count().catch(() => 0) && await btn.isEnabled().catch(() => false)) { await btn.click().catch(() => {}); clic = true; break; }
    }
    if (!clic) await page.keyboard.press('Enter').catch(() => {});
    const ok = await page.waitForFunction((n) => document.querySelectorAll('[data-message-author-role="user"]').length > n
      || document.querySelector('[data-testid="stop-button"]')
      || /generando|creando|generating|creating/i.test(document.body.innerText), nAntes, { timeout: 12000 }).then(() => true).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(1500); await box.click().catch(() => {});
  }
  return false;
}

// Espera 1 imagen NUEVA (fuera de baseline). Devuelve su src (y lo añade a baseline) o null.
async function esperarNueva(page, detectaAll, baseline, minutos) {
  const tope = Date.now() + minutos * 60 * 1000;
  let prev = -1, estable = 0, tick = 0;
  while (Date.now() < tope) {
    await page.waitForTimeout(6000);
    if (++tick % 4 === 0) await page.bringToFront().catch(() => {}); // cada ~24s reactiva la pestaña (anti Memory Saver)
    const nuevas = [...new Set(await detectaAll())].filter((s) => !baseline.has(s));
    if (nuevas.length >= 1 && nuevas.length === prev) { if (++estable >= 2) { const s = nuevas[nuevas.length - 1]; baseline.add(s); return s; } } else estable = 0;
    prev = nuevas.length;
    const lim = await page.evaluate(() => /límite de imágenes|image limit|try again later|inténtalo de nuevo más tarde|demasiado rápido|limitado temporalmente|too many requests|rate.?limit/i.test(document.body.innerText)).catch(() => false);
    if (lim && nuevas.length === 0) throw new Error('LIMITE_IMAGENES');
    process.stdout.write(nuevas.length ? String(nuevas.length) : '.');
  }
  return null;
}

async function bajar(page, src) {
  const b64 = await page.evaluate(async (x) => { const r = await fetch(x); const a = await r.arrayBuffer(); const y = new Uint8Array(a); let s = ''; for (let i = 0; i < y.length; i++) s += String.fromCharCode(y[i]); return btoa(s); }, src);
  return Buffer.from(b64, 'base64');
}

// ── Driver: genera 1 imagen por prompt (carrusel = varios prompts) + caption/hashtags ──
// Genera una pieza REUSANDO el chat/página que ya está abierto (menos "chats nuevos" = menos
// señal de bot). main() maneja la página y cuándo abrir un chat nuevo.
async function generar(page, prompts, label = 'x', asset = LOGO) {
  const detectaAll = () => page.evaluate(() => [...document.querySelectorAll('img')]
    .map((i) => i.currentSrc || i.src || i.getAttribute('src') || '')
    .filter((s) => /estuary\/content|oaiusercontent/.test(s)));
  // Adjunta el asset de referencia de la pieza (logo, o la PORTADA de una guía para ofertas)
  // y fija baseline con lo que YA hay en el chat.
  await page.locator('input[type="file"]').first().setInputFiles(asset).catch(() => {});
  await page.waitForTimeout(6000);
  let baseline = new Set(await detectaAll());
  const srcs = [];
  for (let k = 0; k < prompts.length; k++) {
    if (!await enviar(page, prompts[k])) process.stdout.write('[no arrancó]');
    if (k === 0) {
      // Al enviar, el LOGO adjunto se vuelve imagen "estuary": espéralo y métela al baseline
      // para que NO se cuente como una lámina generada (bug: el logo salía de lámina 1).
      await page.waitForTimeout(9000);
      baseline = new Set([...baseline, ...await detectaAll()]);
    }
    const s = await esperarNueva(page, detectaAll, baseline, 7);
    if (s) srcs.push(s);
    else if (k === 0) break; // si falla la primera imagen, aborta la pieza
    await page.waitForTimeout(TURNO); // pausa entre turnos (ritmo humano)
  }
  process.stdout.write(' ');
  await page.screenshot({ path: `${OUT}/dbg_${label}.png` }).catch(() => {});
  const imgs = [];
  for (const u of srcs) imgs.push(await bajar(page, u));
  let texto = '';
  if (imgs.length) {
    await enviar(page, 'Ahora, SIN generar más imágenes, escribe el pie de foto (caption para Instagram, relatable, con emojis) y en un renglón aparte máximo 5 hashtags en español (máx 5).');
    let prevT = '';
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(4000);
      const full = await page.evaluate(() => document.querySelector('main')?.innerText || '').catch(() => '');
      const cut = full.lastIndexOf('(máx 5)');
      texto = cut > -1 ? full.slice(cut + 7) : full;
      if (/#[\wáéíóúñ]/i.test(texto) && texto === prevT) break;
      prevT = texto;
    }
  }
  return { imgs, texto };
}

// Abre un chat NUEVO en la página compartida (goto con reintento).
async function nuevoChat(page) {
  let nav = false;
  for (let i = 0; i < 2 && !nav; i++) nav = await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 120000 }).then(() => true).catch(() => false);
  if (!nav) throw new Error('no cargó chatgpt.com');
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3500);
}

// Extrae pie de foto + hashtags del texto del asistente (innerText de <main>)
function parseTexto(txt) {
  txt = String(txt || '').replace(/\r/g, '');
  const tags = [...new Set(txt.match(/#[\wáéíóúñÁÉÍÓÚÑ]+/gi) || [])].slice(0, 5).join(' '); // máx 5
  let copy = '';
  const m = txt.match(/(?:pie de foto|caption|copy)\s*:?\s*([\s\S]{20,700}?)(?:#[\wáéíóúñ]|\n\s*hashtags|$)/i);
  if (m) copy = m[1];
  else { const idx = txt.search(/#[\wáéíóúñ]/i); if (idx > 0) copy = txt.slice(Math.max(0, idx - 500), idx); }
  copy = copy.split('\n').map((l) => l.trim())
    .filter((l) => l && !/^hashtags?/i.test(l) && !/imagen generada/i.test(l) && !/^(editar|copiar|compartir)$/i.test(l)
      && !/chatgpt puede cometer|comprueba la informaci|puede cometer errores|se debe comprobar/i.test(l)) // footer de ChatGPT
    .slice(-6).join('\n').trim();
  return { copy: copy.slice(0, 900), hashtags: tags };
}

async function main() {
  const slots = await slotsPendientes();
  if (!slots.length) { console.log('✅ No hay slots pendientes en ese rango.'); return; }
  console.log(`📋 ${slots.length} slots (${slots[0].fecha} → ${slots[slots.length - 1].fecha})`);
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

  if (DRY) { slots.forEach((s) => { const p = promptDe(s); console.log(`\n── ${s.fecha}${s.slot} ${s.formato} (${p.prompts.length} img) ──\n${p.prompts[0].slice(0, 300)}…`); }); return; }

  let b = await chromium.connectOverCDP(CDP);
  let ctx = b.contexts()[0];
  let page = await ctx.newPage();
  await nuevoChat(page); // UN chat, reusado (menos "chats nuevos" = menos señal de bot)
  let ok = 0, err = 0, enChat = 0, seguidos = 0;
  // Si la pestaña se cierra (o el contexto/navegador se cae), reabre/reconecta y sigue (no truena el run).
  const asegurarPage = async () => {
    try {
      if (!page || page.isClosed()) { console.log('  ⚠ la pestaña se cerró; abro una nueva…'); page = await ctx.newPage(); await nuevoChat(page); enChat = 1; }
    } catch {
      console.log('  ⚠ el contexto se cayó; reconecto al navegador…');
      for (let i = 0; i < 5; i++) {
        try { b = await chromium.connectOverCDP(CDP); ctx = b.contexts()[0]; page = await ctx.newPage(); await nuevoChat(page); enChat = 1; return; }
        catch { await new Promise((r) => setTimeout(r, 5000)); }
      }
      throw new Error('no pude reconectar al navegador tras 5 intentos');
    }
  };
  for (const s of slots) {
    await asegurarPage();
    if (enChat >= PORCHAT) { await nuevoChat(page); enChat = 0; } // chat fresco cada N piezas (DOM no crece infinito)
    enChat++;
    const { prompts, assetUrl } = promptDe(s);
    let asset = LOGO;
    if (assetUrl) { // oferta con portada de guía: descarga la portada para adjuntarla
      try { const r = await fetch(assetUrl); asset = `${OUT}/asset_${s.id}.png`; writeFileSync(asset, Buffer.from(await r.arrayBuffer())); }
      catch { asset = LOGO; }
    }
    try {
      console.log(`\n▶ ${s.fecha}${s.slot} ${s.formato} (${prompts.length} img)${assetUrl ? ' [portada guía]' : ''}…`);
      let { imgs, texto } = await generar(page, prompts, `${s.fecha}${s.slot}`, asset);
      if (!imgs.length) {
        // El chat pudo quedar en "modo texto" tras el caption de la pieza anterior → reintenta
        // UNA vez en un chat LIMPIO (el chat fresco siempre genera imagen; ver 13C/14A).
        console.log('  ↻ sin imagen; reintento en chat nuevo…');
        await nuevoChat(page); enChat = 1;
        ({ imgs, texto } = await generar(page, prompts, `${s.fecha}${s.slot}r`, asset));
      }
      // Guard anti-carrusel roto: un carrusel con <3 láminas casi siempre = se acabó el cupo a
      // media generación. NO lo subas roto; trátalo como fallo (cuenta para el corte por cuota).
      if (s.formato === 'CARRUSEL' && imgs.length < 3) {
        console.log(`  ⚠ carrusel incompleto (${imgs.length} lámina/s) → cupo agotado, no lo subo`); err++;
        if (++seguidos >= 2) { console.log('  ⛔ probable cuota/bloqueo de ChatGPT. Paro (reanuda en unas horas).'); break; }
        continue;
      }
      if (!imgs.length) {
        console.log('  ⚠ sin imagen (aun en chat limpio), salto'); err++;
        if (++seguidos >= 2) { console.log('  ⛔ 2 piezas seguidas sin imagen → probable cuota/bloqueo de ChatGPT. Paro (reanuda en unas horas).'); break; }
        continue;
      }
      seguidos = 0;
      const folder = `${MARCA.toLowerCase()}/redes-ig`;
      const urls = [];
      for (let i = 0; i < imgs.length; i++) {
        const file = `${OUT}/${s.formato}_${s.id}_${i + 1}.png`;
        writeFileSync(file, imgs[i]);
        const up = await cloudinary.uploader.upload(file, { public_id: `${folder}/${s.formato}_${s.id}_${i + 1}`, resource_type: 'image', overwrite: true, invalidate: true });
        urls.push(up.secure_url);
      }
      const { copy, hashtags } = parseTexto(texto);
      await sbUpdate(s.id, { titular: s.tema || s.formato, copy, hashtags, imagenes: urls, estado: 'borrador', historia: s.formato !== 'CARRUSEL' });
      console.log(`  ✓ ${urls.length} img subidas · caption ${copy.length}c · ${(hashtags.match(/#/g) || []).length} tags`);
      ok++;
    } catch (e) {
      if (e.message === 'LIMITE_IMAGENES') { console.log('  ⛔ Límite/bloqueo de ChatGPT alcanzado. Paro aquí; reanuda más tarde (con calma).'); break; }
      console.error(`  ✗ ${s.fecha}${s.slot}: ${e.message}`); err++;
    }
    await new Promise((r) => setTimeout(r, PAUSA)); // pacing: no atosigar a ChatGPT
  }
  await b.close().catch(() => {});
  console.log(`\n✅ ${ok} piezas subidas como borrador · ${err} con error. Revísalas en el Estudio.`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
