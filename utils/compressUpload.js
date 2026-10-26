import JSZip from 'jszip';
import sharp from 'sharp';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);
const CLOUDINARY_LIMIT = 10 * 1024 * 1024; // 10 MB

/**
 * Comprime archivos antes de subirlos a Cloudinary (tope de 10 MB en el plan free).
 * - Office (docx/pptx/xlsx): quita FUENTES EMBEBIDAS (lo que más infla, p.ej. 19 MB de
 *   fuentes en un .docx) y recomprime las imágenes internas grandes.
 * - Otros tipos pasan sin cambios (las imágenes sueltas ya las comprime Cloudinary).
 * Si por lo que sea falla, devuelve el archivo original intacto.
 */
const OFFICE_EXT = /\.(docx|pptx|xlsx)$/i;

export const compressForUpload = async (buffer, originalname = '') => {
  try {
    if (OFFICE_EXT.test(originalname || '')) return await compressOffice(buffer);
    // PDFs grandes: recomprimir con Ghostscript (mantiene texto seleccionable)
    if (/\.pdf$/i.test(originalname || '') && buffer.length > 8 * 1024 * 1024) return await compressPdf(buffer);
  } catch (err) {
    console.warn('[compressUpload] no se pudo comprimir, se sube original:', err.message);
  }
  return { buffer, compressed: false };
};

/* ─────────── PDF con Ghostscript ─────────── */
async function runGs(inPath, outPath, preset) {
  await execFileP('gs', [
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=/${preset}`,
    '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dDetectDuplicateImages=true',
    `-sOutputFile=${outPath}`, inPath,
  ], { timeout: 180000 });
}

async function compressPdf(buffer) {
  const base = path.join(os.tmpdir(), `gspdf_${Date.now()}_${Math.round(Math.random() * 1e6)}`);
  const inPath = `${base}_in.pdf`, outPath = `${base}_out.pdf`;
  try {
    await fs.writeFile(inPath, buffer);
    // /ebook (150dpi). Si sigue pasado de 10 MB, escalar a /screen (72dpi).
    await runGs(inPath, outPath, 'ebook');
    let out = await fs.readFile(outPath).catch(() => null);
    if (out && out.length > CLOUDINARY_LIMIT) {
      await runGs(inPath, outPath, 'screen');
      const out2 = await fs.readFile(outPath).catch(() => null);
      if (out2 && out2.length < out.length) out = out2;
    }
    if (out && out.length > 0 && out.length < buffer.length) return { buffer: out, compressed: true, from: buffer.length, to: out.length };
    return { buffer, compressed: false };
  } catch (e) {
    console.warn('[compressUpload] Ghostscript no disponible/falló:', e.message);
    return { buffer, compressed: false };
  } finally {
    fs.unlink(inPath).catch(() => {}); fs.unlink(outPath).catch(() => {});
  }
}

async function compressOffice(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;

  // 1) Quitar fuentes embebidas (odttf/ttf/otf) + sus tablas/relaciones
  for (const p of Object.keys(zip.files)) {
    if (/(^|\/)fonts\/[^/]+\.(odttf|ttf|otf)$/i.test(p) || /(^|\/)fontTable\.xml$/i.test(p) || /_rels\/fontTable\.xml\.rels$/i.test(p)) {
      zip.remove(p); changed = true;
    }
  }
  // 2) Quitar flags de embebido de fuentes en settings.xml
  const settingsPath = Object.keys(zip.files).find((p) => /(^|\/)settings\.xml$/i.test(p));
  if (settingsPath) {
    const s = await zip.file(settingsPath).async('string');
    const s2 = s.replace(/<w:embedTrueTypeFonts[^>]*\/>/g, '').replace(/<w:embedSystemFonts[^>]*\/>/g, '').replace(/<w:saveSubsetFonts[^>]*\/>/g, '');
    if (s2 !== s) { zip.file(settingsPath, s2); changed = true; }
  }
  // 3) Quitar declaraciones de fuentes de [Content_Types].xml
  const ct = zip.file('[Content_Types].xml');
  if (ct) {
    const c = await ct.async('string');
    const c2 = c.replace(/<Default Extension="odttf"[^>]*\/>/gi, '');
    if (c2 !== c) { zip.file('[Content_Types].xml', c2); changed = true; }
  }
  // 4) Recomprimir imágenes internas grandes (media/)
  for (const p of Object.keys(zip.files)) {
    if (/\/media\/[^/]+\.(png|jpe?g)$/i.test(p)) {
      const data = await zip.file(p).async('nodebuffer');
      if (data.length > 300 * 1024) {
        try {
          const isPng = /\.png$/i.test(p);
          let out = sharp(data).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
          out = isPng ? await out.png({ compressionLevel: 9, quality: 80 }).toBuffer() : await out.jpeg({ quality: 72 }).toBuffer();
          if (out.length < data.length) { zip.file(p, out); changed = true; }
        } catch { /* imagen no procesable */ }
      }
    }
  }

  if (!changed) return { buffer, compressed: false };
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  if (out.length < buffer.length) return { buffer: out, compressed: true, from: buffer.length, to: out.length };
  return { buffer, compressed: false };
}

export default { compressForUpload };
