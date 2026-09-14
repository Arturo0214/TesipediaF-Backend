#!/usr/bin/env node
// FASE 2 — Tras tu aprobación: sube las imágenes de /tmp/redes-lote a Cloudinary (con la
// compresión ya activa) y rellena los slots en contenido_social como estado='borrador'
// (para que apruebes/publiques cada uno desde el Estudio). Idempotente: sólo toca los ids
// del lote. No auto-publica nada en redes.
//
//   node scripts/publicarLoteRedes.mjs            # sube y actualiza
//   node scripts/publicarLoteRedes.mjs --dry      # muestra qué haría, sin escribir
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { v2 as cloudinary } from 'cloudinary';

const DRY = process.argv.includes('--dry');
const OUT = '/tmp/redes-lote';
const LOTE = `${OUT}/lote.json`;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };

async function sbUpdate(id, fila) {
  const r = await fetch(`${SB}/rest/v1/contenido_social?id=eq.${id}`, {
    method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify(fila),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || JSON.stringify(d));
  return Array.isArray(d) ? d[0] : d;
}

async function main() {
  if (!existsSync(LOTE)) { console.error(`❌ No existe ${LOTE}. Corre primero la Fase 1.`); process.exit(1); }
  const lote = JSON.parse(readFileSync(LOTE, 'utf8'));
  console.log(`📦 ${lote.length} piezas en el lote.`);

  let ok = 0, err = 0;
  for (const p of lote) {
    try {
      const urls = [];
      for (let i = 0; i < p.archivos.length; i++) {
        const file = `${OUT}/${p.archivos[i]}`;
        if (DRY) { urls.push(`(dry)/${p.archivos[i]}`); continue; }
        const up = await cloudinary.uploader.upload(file, {
          public_id: `tesipedia/redes-cg/${p.formato}_${p.id}${p.archivos.length > 1 ? '_' + (i + 1) : ''}`,
          resource_type: 'image', overwrite: true, invalidate: true,
        });
        urls.push(up.secure_url);
      }
      const fila = {
        titular: p.titular, laminas: p.laminas, copy: p.copy, cta: p.cta,
        hashtags: p.hashtags, imagenes: urls, estado: 'borrador',
        historia: p.formato !== 'CARRUSEL',
      };
      if (DRY) { console.log(`  (dry) id=${p.id} ${p.formato} ${p.fecha}${p.slot} · ${urls.length} img · "${p.titular.replace(/\n/g, ' ').slice(0, 50)}…"`); ok++; continue; }
      await sbUpdate(p.id, fila);
      console.log(`  ✓ id=${p.id} ${p.formato} ${p.fecha}${p.slot} · ${urls.length} img`);
      ok++;
    } catch (e) { console.error(`  ✗ id=${p.id}: ${e.message}`); err++; }
  }
  console.log(`\n${DRY ? '(DRY) ' : ''}✅ ${ok} piezas actualizadas · ${err} errores. Apruébalas/publícalas desde el Estudio.`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
