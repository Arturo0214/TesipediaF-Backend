// Catálogo de guías/productos digitales de Tesipedia — data-driven.
// Los datos viven en guiasData.js; los assets (muestra/páginas/completa) en Cloudinary,
// referenciados por guiasAssets.json (generado por scripts/uploadGuiasCloudinary.js).
// El pago (MercadoPago/Stripe) es genérico y funciona para cualquier producto de aquí.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GUIAS_DATA, PAQUETES_DATA, getGuiaById } from './guiasData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let MANIFEST = {};
try { MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'guiasAssets.json'), 'utf8')); } catch { MANIFEST = {}; }

function incluyeDe(g) {
  if (g.tipo === 'carrera') return ['Guía completa en PDF (49 págs)', '60 temas de tesis con población y diseño sugerido', 'Checklist de 30 puntos', 'Plantillas y anexos'];
  if (g.tipo === 'citacion') return ['Guía completa en PDF (49 págs)', '50-60 pares «así no / así sí» con ejemplos', 'Fichas modelo y checklist de 30 puntos', 'Plantillas y anexos'];
  if (g.tipo === 'universidad') return ['Guía completa del trámite en PDF', '10 módulos + 4 anexos de consulta permanente', 'Tabla de documentos y diferencias por facultad', 'Checklist de 30 puntos'];
  return ['Guía completa en PDF (49 págs)', 'Ejercicios resueltos sobre la página', 'Checklist de 30 puntos', 'Plantillas y anexos'];
}

function buildGuia(g) {
  const m = MANIFEST[g.id] || {};
  const archivos = [];
  if (m.completaPublicId) archivos.push({ label: `${g.nombre} (PDF)`, publicId: m.completaPublicId });
  for (const ex of (m.extras || [])) {
    const label = ex.file.includes('laminas') ? 'Láminas para consulta rápida (ZIP)' : 'Plantilla / fuente editable (ZIP)';
    archivos.push({ label, publicId: ex.publicId });
  }
  return { ...g, currency: 'MXN', muestraUrl: m.muestra || null, pages: m.pages || [], incluye: incluyeDe(g), archivos };
}

function buildPaquete(p) {
  const archivos = [];
  for (const id of p.incluyeIds) {
    const m = MANIFEST[id]; const g = getGuiaById(id);
    if (m?.completaPublicId) archivos.push({ label: `${g?.nombre || id} (PDF)`, publicId: m.completaPublicId });
  }
  const first = MANIFEST[p.incluyeIds[0]] || {};
  return {
    ...p, currency: 'MXN', muestraUrl: first.muestra || null, pages: first.pages || [],
    incluye: p.incluyeIds.map((id) => getGuiaById(id)?.nombre || id), archivos,
  };
}

export const GUIA_PRODUCTOS = Object.fromEntries([
  ...GUIAS_DATA.map((g) => [g.id, buildGuia(g)]),
  ...PAQUETES_DATA.map((p) => [p.id, buildPaquete(p)]),
]);

export function getProducto(id) { return GUIA_PRODUCTOS[id] || null; }
