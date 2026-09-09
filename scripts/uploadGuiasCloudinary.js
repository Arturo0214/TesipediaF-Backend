// Sube las guías a Cloudinary (Tesipedia dbowaer8j) para que NO pesen en el repo.
//   · muestra  → raw público  (descarga + preview iframe)
//   · page-1/3/4 → image público (showcases del hero/blog/producto)
//   · completa → raw AUTHENTICATED (privado; se entrega con URL firmada tras el pago)
//   · extras (zips de APA) → raw authenticated
// Escribe el manifiesto en config/guiasAssets.json (backend) y lo copia al frontend.
//
// Uso:
//   node scripts/uploadGuiasCloudinary.js            # todas
//   node scripts/uploadGuiasCloudinary.js apa-7      # solo una (para probar)
//   GUIAS_SRC="/ruta" node scripts/uploadGuiasCloudinary.js
//
// Requiere: CLOUDINARY_* en .env, y pdftoppm (poppler) instalado.

import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { GUIAS_DATA } from '../config/guiasData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.GUIAS_SRC
  || '/Users/arturosuarez/Documents/Claude/Projects/Proyectos - Tesis/Tesipedia-Guias';
const OUT_BACKEND = path.join(__dirname, '..', 'config', 'guiasAssets.json');
const OUT_FRONTEND = path.join(__dirname, '..', '..', 'Frontend', 'src', 'data', 'guiasAssets.json');
const PAGES = [1, 3, 4]; // portada · índice · primer módulo

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const only = process.argv[2] || null;

function findPdf(folderAbs, { muestra }) {
  const files = fs.readdirSync(folderAbs).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const isM = (f) => /_MUESTRA\.pdf$/i.test(f);
  const cands = files.filter((f) => (muestra ? isM(f) : !isM(f)))
    // preferir los numerados Tesipedia_<NN|CN>_ sobre variantes viejas
    .sort();
  return cands[0] ? path.join(folderAbs, cands[0]) : null;
}

async function uploadRaw(file, publicId, { authenticated } = {}) {
  return cloudinary.uploader.upload(file, {
    resource_type: 'raw',
    public_id: publicId, // incluye .pdf/.zip para servir con el content-type correcto
    type: authenticated ? 'authenticated' : 'upload',
    overwrite: true, invalidate: true,
  });
}

async function uploadImage(file, publicId) {
  return cloudinary.uploader.upload(file, {
    resource_type: 'image', public_id: publicId, type: 'upload',
    overwrite: true, invalidate: true, format: 'png',
  });
}

async function run() {
  if (!process.env.CLOUDINARY_API_SECRET) {
    console.error('Falta CLOUDINARY_API_SECRET en .env'); process.exit(1);
  }
  const manifest = fs.existsSync(OUT_BACKEND) ? JSON.parse(fs.readFileSync(OUT_BACKEND, 'utf8')) : {};
  const list = GUIAS_DATA.filter((g) => !only || g.id === only);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guias-'));

  for (const g of list) {
    const folderAbs = path.join(SRC, g.folder);
    if (!fs.existsSync(folderAbs)) { console.warn(`⚠ sin carpeta: ${g.folder}`); continue; }
    const muestra = findPdf(folderAbs, { muestra: true });
    const completa = findPdf(folderAbs, { muestra: false });
    if (!muestra || !completa) { console.warn(`⚠ ${g.id}: faltan PDFs`); continue; }
    console.log(`\n▶ ${g.id}  (${path.basename(completa)})`);

    // 1) imágenes de página desde la muestra
    const prefix = path.join(tmp, g.id);
    execSync(`pdftoppm -png -r 150 -f 1 -l 6 "${muestra}" "${prefix}"`, { stdio: 'ignore' });

    const entry = { pages: [], extras: [] };

    // 2) subir páginas
    for (const n of PAGES) {
      const img = `${prefix}-${n}.png`;
      if (!fs.existsSync(img)) continue;
      const r = await uploadImage(img, `tesipedia/guias/${g.id}/page-${n}`);
      entry.pages.push(r.secure_url);
      process.stdout.write(`  page-${n} ✓`);
    }

    // 3) muestra pública (raw)
    const rm = await uploadRaw(muestra, `tesipedia/guias/${g.id}/muestra.pdf`);
    entry.muestra = rm.secure_url;
    process.stdout.write('  muestra ✓');

    // 4) completa privada (raw authenticated)
    const rc = await uploadRaw(completa, `tesipedia/guias/${g.id}/completa.pdf`, { authenticated: true });
    entry.completaPublicId = rc.public_id; // se firma al entregar
    process.stdout.write('  completa ✓');

    // 5) extras (zips) privados
    for (const ex of (g.extras || [])) {
      const exPath = fs.readdirSync(folderAbs).find((f) => f.toLowerCase().endsWith('.zip')
        && f.toLowerCase().includes(ex.replace('.zip', '').split('-')[0]));
      if (!exPath) continue;
      const r = await uploadRaw(path.join(folderAbs, exPath), `tesipedia/guias/${g.id}/${ex}`, { authenticated: true });
      entry.extras.push({ file: ex, publicId: r.public_id });
    }

    manifest[g.id] = entry;
    console.log('  → OK');
    // guardar incremental por si se corta
    fs.writeFileSync(OUT_BACKEND, JSON.stringify(manifest, null, 2));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(OUT_BACKEND, JSON.stringify(manifest, null, 2));
  fs.mkdirSync(path.dirname(OUT_FRONTEND), { recursive: true });
  // El frontend solo necesita lo público (muestra + páginas), no los public_id privados.
  const publicManifest = Object.fromEntries(Object.entries(manifest).map(([id, e]) => [id, { muestra: e.muestra, pages: e.pages }]));
  fs.writeFileSync(OUT_FRONTEND, JSON.stringify(publicManifest, null, 2));
  console.log(`\n✅ Manifiesto: ${Object.keys(manifest).length} guías → ${OUT_BACKEND}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
