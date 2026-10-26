import JSZip from 'jszip';
import sharp from 'sharp';
import path from 'path';

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
  } catch (err) {
    console.warn('[compressUpload] no se pudo comprimir, se sube original:', err.message);
  }
  return { buffer, compressed: false };
};

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
