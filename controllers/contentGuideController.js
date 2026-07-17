// controllers/contentGuideController.js
// Loop de contenido/SEO (#3): genera guías anonimizadas por carrera desde el
// corpus de cotizaciones pagadas, las deja como borrador para revisar/publicar,
// y las expone públicamente para inyectarlas en la landing de esa carrera.
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ContentGuide from '../models/ContentGuide.js';

const MIN_VENDIDAS = 3; // mínimo de trabajos vendidos por carrera para generar guía

// Slug estilo landing: "Enfermería" → "tesis-de-enfermeria"
const slugify = (s) =>
  'tesis-de-' +
  (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// Construye una guía anonimizada determinista (sin costo de IA) a partir de las stats
function buildGuide(carrera, area, docs) {
  const paginas = docs.map((d) => parseInt(d.extensionEstimada, 10)).filter((n) => n > 0);
  const tickets = docs.map((d) => Number(d.precioConDescuento) || 0).filter((n) => n > 0);
  const temasTop = [...new Set(docs.map((d) => (d.tituloTrabajo || '').trim()).filter((t) => t && t.length > 6))].slice(0, 6);

  const avgPaginas = paginas.length ? Math.round(paginas.reduce((a, b) => a + b, 0) / paginas.length) : null;
  const ticketMediana = median(tickets);

  const intro =
    `Elaborar una tesis de ${carrera} exige rigor metodológico, dominio del formato de tu universidad y una estructura clara. ` +
    `En Tesipedia hemos acompañado a estudiantes de ${carrera} en su titulación; esta guía resume la estructura, los pasos y las dudas más frecuentes para que llegues a una versión lista para revisión.`;

  const sections = [
    {
      heading: `¿Cómo se estructura una tesis de ${carrera}?`,
      body:
        `Una tesis de ${carrera} suele organizarse en: planteamiento del problema, marco teórico, metodología, resultados y conclusiones. ` +
        (avgPaginas ? `Con base en los proyectos que hemos desarrollado, una extensión típica ronda las ${avgPaginas} páginas, ` : '') +
        `ajustada a los lineamientos de tu institución. Cada capítulo se construye de forma progresiva, cuidando la coherencia argumentativa y la citación.`,
    },
    {
      heading: `Metodología recomendada en ${carrera}`,
      body:
        `Según el enfoque de tu investigación en ${carrera}, trabajamos diseños cuantitativos, cualitativos o mixtos, con instrumentos validados y análisis apropiado. ` +
        `Definimos objetivos, preguntas e hipótesis alineados, y seleccionamos la técnica de análisis que tu jurado espera para el área de ${area || 'tu disciplina'}.`,
    },
    {
      heading: `Pasos para titularte con tu tesis de ${carrera}`,
      body:
        `1) Define tema y viabilidad. 2) Construye el protocolo (problema, justificación, objetivos). 3) Desarrolla el marco teórico. ` +
        `4) Aplica la metodología y recolecta datos. 5) Analiza resultados y redacta conclusiones. 6) Revisa formato y prepara la defensa. ` +
        `Podemos acompañarte en el proceso completo o en la etapa donde estés atorado.`,
    },
  ];

  // FAQs — algunas cruzan el loop de objeciones (#4): respondemos las dudas reales
  const faqs = [
    {
      q: `¿Cuánto cuesta una tesis de ${carrera}?`,
      a:
        (ticketMediana
          ? `El precio depende del nivel, la extensión y la urgencia. Para proyectos de ${carrera} el rango típico ronda los $${ticketMediana.toLocaleString('es-MX')}, `
          : `El precio depende del nivel, la extensión y la urgencia; `) +
        `y trabajamos esquemas de pago en parcialidades para que se ajuste a tu presupuesto. Cotiza gratis por WhatsApp.`,
    },
    {
      q: `¿Puedo pagar en partes?`,
      a: `Sí. Ofrecemos esquemas como 33-33-34, 50-50 o pagos quincenales/mensuales, precisamente para que el presupuesto no sea un obstáculo.`,
    },
    {
      q: `¿Es confiable? ¿Cómo sé que no es un fraude?`,
      a: `Trabajamos con contrato, entregas por etapas y acompañamiento hasta la versión final. Puedes validar avances antes de continuar; nada de pagar todo por adelantado a ciegas.`,
    },
    {
      q: `¿En cuánto tiempo entregan?`,
      a: `Depende de la extensión y la fecha de tu titulación. Manejamos tiempos estándar y también entregas con urgencia; dinos tu fecha y lo ajustamos.`,
    },
  ];

  return {
    carrera,
    slug: slugify(carrera),
    area: area || '',
    title: `Cómo hacer una tesis de ${carrera}: estructura, metodología y costos`,
    intro,
    sections,
    faqs,
    keywords: [
      `tesis de ${carrera.toLowerCase()}`,
      `cómo hacer tesis de ${carrera.toLowerCase()}`,
      `estructura tesis ${carrera.toLowerCase()}`,
      `costo tesis ${carrera.toLowerCase()}`,
    ],
    stats: { quotesVendidas: docs.length, avgPaginas, ticketMediana, temasTop },
  };
}

// @desc    Genera/actualiza borradores de guía desde el corpus de trabajo vendido
// @route   POST /content-guides/generate
// @access  Admin
export const generateGuidesFromCorpus = asyncHandler(async (req, res) => {
  const db = mongoose.connection.db;
  const gq = db.collection('generatedquotes');

  // Trabajo vendido = cotizaciones pagadas, agrupadas por carrera
  const paid = await gq
    .find({ status: 'paid' }, { projection: { carrera: 1, area: 1, extensionEstimada: 1, precioConDescuento: 1, tituloTrabajo: 1 } })
    .toArray();

  const porCarrera = new Map();
  for (const d of paid) {
    const c = (d.carrera || '').trim();
    if (!c) continue;
    if (!porCarrera.has(c)) porCarrera.set(c, []);
    porCarrera.get(c).push(d);
  }

  const results = { creadas: 0, actualizadas: 0, omitidas: 0, guias: [] };
  for (const [carrera, docs] of porCarrera) {
    if (docs.length < MIN_VENDIDAS) { results.omitidas++; continue; }
    const area = docs.find((d) => d.area)?.area || '';
    const draft = buildGuide(carrera, area, docs);

    const existing = await ContentGuide.findOne({ slug: draft.slug });
    if (existing && existing.status === 'published') {
      // no pisar contenido ya publicado/curado; solo refrescar stats
      existing.stats = draft.stats;
      await existing.save();
      results.actualizadas++;
      results.guias.push({ slug: draft.slug, carrera, status: 'published (stats)', vendidas: docs.length });
      continue;
    }
    if (existing) {
      Object.assign(existing, draft);
      await existing.save();
      results.actualizadas++;
    } else {
      await ContentGuide.create(draft);
      results.creadas++;
    }
    results.guias.push({ slug: draft.slug, carrera, status: 'draft', vendidas: docs.length });
  }

  results.guias.sort((a, b) => b.vendidas - a.vendidas);
  res.json(results);
});

// @desc    Lista guías (admin)
// @route   GET /content-guides
// @access  Admin
export const listGuides = asyncHandler(async (req, res) => {
  const guides = await ContentGuide.find({}).sort({ 'stats.quotesVendidas': -1, updatedAt: -1 });
  res.json(guides);
});

// @desc    Actualiza una guía (edición manual)
// @route   PUT /content-guides/:id
// @access  Admin
export const updateGuide = asyncHandler(async (req, res) => {
  const g = await ContentGuide.findById(req.params.id);
  if (!g) { res.status(404); throw new Error('Guía no encontrada'); }
  const editable = ['title', 'intro', 'sections', 'faqs', 'keywords', 'area'];
  for (const k of editable) if (req.body[k] !== undefined) g[k] = req.body[k];
  await g.save();
  res.json(g);
});

// @desc    Publica / despublica una guía
// @route   PATCH /content-guides/:id/publish
// @access  Admin
export const publishGuide = asyncHandler(async (req, res) => {
  const g = await ContentGuide.findById(req.params.id);
  if (!g) { res.status(404); throw new Error('Guía no encontrada'); }
  const publish = req.body.publish !== false;
  g.status = publish ? 'published' : 'draft';
  g.publishedAt = publish ? new Date() : null;
  await g.save();
  res.json(g);
});

// @desc    Elimina una guía
// @route   DELETE /content-guides/:id
// @access  Admin
export const deleteGuide = asyncHandler(async (req, res) => {
  const g = await ContentGuide.findByIdAndDelete(req.params.id);
  if (!g) { res.status(404); throw new Error('Guía no encontrada'); }
  res.json({ message: 'Guía eliminada', id: req.params.id });
});

// @desc    Guía publicada por slug (público — la consume la landing)
// @route   GET /content-guides/public/:slug
// @access  Public
export const getPublicGuide = asyncHandler(async (req, res) => {
  const g = await ContentGuide.findOne({ slug: req.params.slug, status: 'published' })
    .select('carrera slug title intro sections faqs keywords updatedAt');
  if (!g) { res.status(404); throw new Error('Guía no disponible'); }
  res.json(g);
});
