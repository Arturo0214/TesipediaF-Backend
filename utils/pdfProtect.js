/**
 * Procesamiento de documentos protegidos del portal del cliente.
 *
 * Objetivo: el cliente NUNCA recibe el PDF real — solo imágenes renderizadas en el
 * servidor. Antes de pagar: marca de agua horneada + SIN la sección de referencias
 * (detectada por el índice/TOC o por texto). Al liquidar: imágenes limpias de todas
 * las páginas + se libera la descarga del PDF original.
 */
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Factory de canvas para que pdf.js renderice en Node (@napi-rs/canvas, prebuilt)
const canvasFactory = {
  create: (w, h) => { const canvas = createCanvas(Math.ceil(w), Math.ceil(h)); return { canvas, context: canvas.getContext('2d') }; },
  reset: (co, w, h) => { co.canvas.width = Math.ceil(w); co.canvas.height = Math.ceil(h); },
  destroy: (co) => { if (co.canvas) { co.canvas.width = 0; co.canvas.height = 0; } co.canvas = null; co.context = null; },
};

const loadPdf = (buffer) =>
  pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;

// Encabezados que marcan el inicio de la sección de referencias/bibliografía
const REF_RE = /^\s*(\d+\.?\s*)?(referencias?( bibliogr[aá]ficas)?|bibliograf[ií]a|fuentes( de consulta| bibliogr[aá]ficas)?|obras citadas|works cited|references)\s*$/i;
const REF_LOOSE = /\b(referencias|bibliograf[ií]a|fuentes de consulta|works cited|references)\b/i;

/**
 * Página (1-based) donde empiezan las referencias, o null si no se detecta.
 * 1º intenta el OUTLINE/TOC embebido; si no, escanea el texto por página.
 */
export const findReferencesStartPage = async (pdf) => {
  // 1) Outline / marcadores (el "TOC" del documento)
  try {
    const outline = await pdf.getOutline();
    if (outline && outline.length) {
      for (const item of outline) {
        if (REF_LOOSE.test(item.title || '')) {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (dest && dest[0]) {
            const pageIndex = await pdf.getPageIndex(dest[0]);
            if (pageIndex >= 0) return pageIndex + 1;
          }
        }
      }
    }
  } catch { /* sin outline utilizable */ }

  // 2) Escaneo de texto: primera página cuyo encabezado sea "Referencias/Bibliografía"
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    // Tomar las primeras líneas (por posición Y) para ver el encabezado real de la página
    const items = tc.items.filter((it) => it.str && it.str.trim());
    if (!items.length) continue;
    const topY = Math.max(...items.map((it) => it.transform[5]));
    const encabezado = items.filter((it) => it.transform[5] >= topY - 24).map((it) => it.str).join(' ').trim();
    if (REF_RE.test(encabezado)) return i;
  }
  return null;
};

// Censura estilo "documento confidencial": tapa ~60% de las líneas con barras negras,
// agrupando el texto por línea. Aunque capturen la pantalla, no tienen el texto completo.
const redactPage = (ctx, textContent, viewport) => {
  const items = (textContent.items || []).filter((it) => it.str && it.str.trim());
  const lines = [];
  for (const it of items) {
    const tx = pdfjs.Util.transform(viewport.transform, it.transform);
    const x = tx[4], y = tx[5];
    const hh = Math.hypot(tx[2], tx[3]) || (it.height * viewport.scale) || 12;
    const w = (it.width || 0) * viewport.scale;
    let line = lines.find((L) => Math.abs(L.y - y) < hh * 0.6);
    if (!line) lines.push({ y, h: hh, minX: x, maxX: x + w });
    else { line.minX = Math.min(line.minX, x); line.maxX = Math.max(line.maxX, x + w); line.h = Math.max(line.h, hh); }
  }
  lines.sort((a, b) => a.y - b.y);
  ctx.fillStyle = '#10151f';
  lines.forEach((L, i) => {
    // patrón determinista: tapa líneas en posiciones 0,2,3 de cada 5 (~60%), deja 1 y 4 legibles
    const m = i % 5;
    if (m === 0 || m === 2 || m === 3) {
      const h = L.h; const w = (L.maxX - L.minX);
      if (w > 4) ctx.fillRect(L.minX - 3, L.y - h, w + 6, h * 1.25);
    }
  });
};

const bakeWatermark = (ctx, w, h, text) => {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#b00020';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 5);
  const size = Math.max(26, Math.round(w / 16));
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  const step = size * 3.2;
  for (let y = -h; y < h; y += step) {
    for (let x = -w; x < w; x += ctx.measureText(text).width + size * 2) {
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
};

/**
 * Renderiza páginas a PNG. { scale, watermark, fromPage, toPage }.
 * Devuelve [{ buffer, width, height, page }].
 */
export const renderToImages = async (buffer, { scale = 2.1, watermark = '', redact = false, fromPage = 1, toPage = null } = {}) => {
  const pdf = await loadPdf(buffer);
  const last = toPage ? Math.min(toPage, pdf.numPages) : pdf.numPages;
  const out = [];
  for (let i = fromPage; i <= last; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvasFactory }).promise;
    if (redact) { const tc = await page.getTextContent(); redactPage(ctx, tc, viewport); }
    bakeWatermark(ctx, canvas.width, canvas.height, watermark);
    out.push({ buffer: canvas.toBuffer('image/jpeg', 0.92), width: canvas.width, height: canvas.height, page: i });
  }
  try { await pdf.destroy(); } catch { /* noop */ }
  return out;
};

/**
 * Procesa un documento para el estado BLOQUEADO (antes de pagar):
 * imágenes con marca de agua, SIN la sección de referencias.
 * @returns { numPages, refStartPage, images:[{buffer,width,height,page}] }
 */
export const buildLockedPreview = async (buffer, { watermark = 'TESIPEDIA · MUESTRA' } = {}) => {
  const pdf = await loadPdf(buffer);
  const numPages = pdf.numPages;
  const refStartPage = await findReferencesStartPage(pdf);
  try { await pdf.destroy(); } catch { /* noop */ }
  const toPage = refStartPage ? refStartPage - 1 : numPages; // cortar antes de referencias
  const images = await renderToImages(buffer, { watermark, redact: true, toPage });
  return { numPages, refStartPage, images };
};

/** Procesa el documento LIMPIO (ya pagado): todas las páginas, sin marca de agua. */
export const buildCleanImages = async (buffer) => {
  const pdf = await loadPdf(buffer);
  const numPages = pdf.numPages;
  try { await pdf.destroy(); } catch { /* noop */ }
  const images = await renderToImages(buffer, { watermark: '' });
  return { numPages, images };
};

export default { findReferencesStartPage, renderToImages, buildLockedPreview, buildCleanImages };
