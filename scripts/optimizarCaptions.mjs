// Reescribe los captions de TODO el contenido generado con la fórmula viral 2026:
//   afirmación-gancho → keyword de búsqueda (SEO) → valor breve → CTA de send/save → pregunta → hashtags nicho.
// NO toca imágenes. Conserva la esencia del cuerpo si sirve. Sube gancho/SEO/sends del evaluador.
//   node scripts/optimizarCaptions.mjs [--marca ambas] [--desde 2026-09-01] [--dry]
import 'dotenv/config';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const MARCA = arg('--marca', 'ambas');
const DESDE = arg('--desde', '2026-09-01');
const DRY = process.argv.includes('--dry');
const REELS = process.argv.includes('--reels');
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };

// Bancos por tema. hook = AFIRMACIÓN (matchea el evaluador), kw = frase que la gente TECLEA (SEO), tags = 3-5 nicho.
const TOPICS = {
  Tesipedia: [
    { re: /marco te[oó]rico/i, hook: 'Tu marco teórico está mal (y así se arregla).', kw: 'marco teórico', tags: ['#tesis', '#marcoteorico', '#tesisuniversitaria', '#tesipedia'] },
    { re: /planteamiento|problema de inv/i, hook: 'Tu planteamiento del problema no cuadra.', kw: 'planteamiento del problema', tags: ['#tesis', '#metodologia', '#tesisuniversitaria', '#tesipedia'] },
    { re: /\bapa\b|cita|referencia|formato/i, hook: 'Estás citando mal en APA y ni lo sabes.', kw: 'normas APA', tags: ['#tesis', '#normasapa', '#citas', '#tesipedia'] },
    { re: /metodolog|método/i, hook: 'Tu metodología no aguanta una revisión.', kw: 'metodología de la investigación', tags: ['#tesis', '#metodologia', '#investigacion', '#tesipedia'] },
    { re: /medicina|imryd/i, hook: 'Tu tesis de Medicina necesita este formato.', kw: 'cómo hacer una tesis de medicina', tags: ['#tesis', '#medicina', '#tesisdemedicina', '#tesipedia'] },
    { re: /antecedente|estado del arte/i, hook: 'Confundes antecedentes con marco teórico.', kw: 'estado del arte tesis', tags: ['#tesis', '#investigacion', '#tesisuniversitaria', '#tesipedia'] },
    { re: /herramienta|\bia\b|inteligencia|chatgpt/i, hook: 'Estás haciendo tu tesis a mano por gusto.', kw: 'herramientas para hacer tesis', tags: ['#tesis', '#estudiantes', '#productividad', '#tesipedia'] },
    { re: /objetivo|hip[oó]tesis/i, hook: 'Tus objetivos y tu hipótesis no coinciden.', kw: 'objetivos de investigación', tags: ['#tesis', '#metodologia', '#tesisuniversitaria', '#tesipedia'] },
    { re: /resultado|discusi[oó]n|conclusi/i, hook: 'Tus resultados dicen menos de lo que crees.', kw: 'resultados y discusión tesis', tags: ['#tesis', '#investigacion', '#universidad', '#tesipedia'] },
  ],
  Contratado: [
    { re: /\bats\b|filtro|pasar/i, hook: 'El 75% de los CV muere en el filtro ATS.', kw: 'cv que pasa el ATS', tags: ['#buscoempleo', '#cvats', '#curriculum', '#contratado'] },
    { re: /plantilla/i, hook: 'Tu formato de CV te cuesta entrevistas.', kw: 'plantillas de cv gratis', tags: ['#buscoempleo', '#curriculum', '#cv', '#contratado'] },
    { re: /adapta|keyword|palabra clave|vacante espec/i, hook: 'Mandas el mismo CV a todo. Por eso no te llaman.', kw: 'cómo adaptar el cv a la vacante', tags: ['#buscoempleo', '#cvats', '#empleomexico', '#contratado'] },
    { re: /entrevista|star/i, hook: 'Repruebas la entrevista en la primera pregunta.', kw: 'preguntas de entrevista de trabajo', tags: ['#buscoempleo', '#entrevistadetrabajo', '#empleo', '#contratado'] },
    { re: /carta/i, hook: 'Tu carta de presentación no la lee nadie.', kw: 'carta de presentación', tags: ['#buscoempleo', '#curriculum', '#empleomexico', '#contratado'] },
    { re: /linkedin/i, hook: 'Tu LinkedIn te está costando entrevistas.', kw: 'cómo optimizar linkedin', tags: ['#buscoempleo', '#linkedin', '#empleo', '#contratado'] },
    { re: /vacante|semarnat|gobierno|dof|plaza/i, hook: 'Están contratando y ni te enteras.', kw: 'vacantes de gobierno', tags: ['#vacantes', '#empleomexico', '#buscoempleo', '#contratado'] },
    { re: /sueldo|salario|negoci/i, hook: 'Estás dejando dinero en la mesa al negociar.', kw: 'cómo negociar el sueldo', tags: ['#empleo', '#sueldo', '#buscoempleo', '#contratado'] },
    { re: /pro|plan|gratis|oferta|analiz/i, hook: 'Tu CV pierde en los primeros 6 segundos.', kw: 'cv que pasa el ATS', tags: ['#buscoempleo', '#cvats', '#curriculum', '#contratado'] },
  ],
};
const FALLBACK = {
  Tesipedia: { hook: 'Nadie te enseña a hacer bien la tesis.', kw: 'cómo hacer una tesis', tags: ['#tesis', '#tesisuniversitaria', '#estudiantes', '#tesipedia'] },
  Contratado: { hook: 'Llevas semanas postulando sin una sola respuesta.', kw: 'cómo conseguir empleo', tags: ['#buscoempleo', '#empleomexico', '#curriculum', '#contratado'] },
};
const SEND = {
  Tesipedia: ['📌 Guárdalo y mándaselo a quien sigue atorado en su tesis.', '📌 Guarda esto y compártelo con tu compañero de tesis.', '📌 Guárdalo para cuando te sientes a escribir y etiqueta a quien lo necesita.'],
  Contratado: ['📌 Guárdalo y etiqueta a quien anda buscando chamba.', '📌 Guarda esto y mándaselo a quien lleva meses postulando.', '📌 Guárdalo antes de tu próxima postulación y compártelo.'],
};
const PREGUNTA = {
  Tesipedia: ['¿En qué parte de la tesis estás atorado? 👇', '¿Vas en el capítulo 1 o ya casi? 👇', '¿Qué es lo que más se te complica de la tesis? 👇'],
  Contratado: ['¿Cuántas vacantes llevas sin respuesta? 👇', '¿Cuál de estos errores estabas cometiendo? 👇', '¿En qué parte del proceso te trabas? 👇'],
};
const KWLINE = {
  Tesipedia: (kw) => `Todo lo que necesitas saber sobre ${kw}, sin dar tantas vueltas.`,
  Contratado: (kw) => `Lo esencial de ${kw}, directo y sin relleno.`,
};

// Toma la esencia del cuerpo actual (1ª frase útil, sin hashtags/urls/CTA viejos) para no perder el valor de ChatGPT.
function esencia(copy) {
  let t = String(copy || '').replace(/#[\wáéíóúñ]+/gi, '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const frase = t.split(/(?<=[.!?…])\s/).find((s) => s.length > 25 && /^[¿"A-ZÁÉÍÓÚÑ¡0-9]/.test(s) && !/gu[aá]rda|m[aá]ndaselo|et[ií]queta|cotiza|cont[aá]ctanos/i.test(s));
  return frase ? frase.slice(0, 150).trim() : ''; // si no hay frase limpia (empieza cortada), no metas basura
}
const topicDe = (marca, tema, copy) => (TOPICS[marca] || []).find((t) => t.re.test(`${tema} ${copy}`)) || FALLBACK[marca] || FALLBACK.Tesipedia;
const rot = (arr, i) => arr[i % arr.length];

const GANCHO_RE = [/^\s*\d/, /\d+\s*%/, /\bpov\b/i, /deja de/i, /nadie te/i, /est[aá] mal|est[aá]s/i, /\b(muere|pierde|cuesta|reprueba|falla)\b/i, /^tu\b/i];
// Conserva TODO el cuerpo del caption (limpio de hashtags/urls/CTA viejos), para reels.
function cuerpoLimpio(copy) {
  return String(copy || '').replace(/#[\wáéíóúñ]+/gi, '').replace(/https?:\/\/\S+/gi, '')
    .split('\n').map((l) => l.trim()).filter((l) => l && !/gu[aá]rda esto|m[aá]ndaselo|et[ií]queta a|cotiza con|cont[aá]ctanos/i.test(l)).join(' ').replace(/\s+/g, ' ').trim();
}

function construir(p, i = 0) {
  const marca = p.marca;
  const t = topicDe(marca, p.tema || p.titular || '', p.copy || '');
  const esReel = p.formato === 'VIDEO' || !!p.video_url;
  if (esReel) {
    // Reels: CONSERVA el caption original (su voz) y solo agrega andamiaje viral.
    const orig = cuerpoLimpio(p.copy);
    const abreFuerte = orig && GANCHO_RE.some((r) => r.test(orig.slice(0, 40)));
    const cuerpo = [abreFuerte ? null : t.hook, orig || t.hook, (KWLINE[marca] || KWLINE.Tesipedia)(t.kw), rot(SEND[marca], i), rot(PREGUNTA[marca], i)]
      .filter(Boolean).filter((v, j, a) => a.indexOf(v) === j).join('\n\n');
    return { copy: cuerpo.slice(0, 700), hashtags: t.tags.slice(0, 5).join(' ') };
  }
  const val = esencia(p.copy);
  const swipe = p.formato === 'CARRUSEL' ? ' Desliza 👉' : '';
  // gancho (afirmación) + valor + keyword natural (SEO) + send/save + pregunta
  const cuerpo = [t.hook + swipe, val, (KWLINE[marca] || KWLINE.Tesipedia)(t.kw), rot(SEND[marca], i), rot(PREGUNTA[marca], i)].filter(Boolean).join('\n\n');
  return { copy: cuerpo.slice(0, 700), hashtags: t.tags.slice(0, 5).join(' ') };
}

async function main() {
  const marcas = MARCA === 'ambas' ? ['Tesipedia', 'Contratado'] : [MARCA];
  const filas = [];
  for (const m of marcas) {
    const r = await fetch(`${SB}/rest/v1/contenido_social?select=id,fecha,slot,marca,formato,tema,copy,hashtags,imagenes,video_url,titular&marca=eq.${m}&fecha=gte.${DESDE}&order=fecha,slot`, { headers: H });
    const d = await r.json(); if (!r.ok) throw new Error(JSON.stringify(d));
    const esReel = (x) => x.formato === 'VIDEO' || !!x.video_url;
    // Default: piezas de imagen generadas. Con --reels: reels REALES (con video o caption), no placeholders vacíos.
    const filtro = REELS ? (x) => esReel(x) && (!!x.video_url || (x.copy || '').trim().length > 10) : (x) => (x.imagenes || []).length && !esReel(x);
    for (const p of d.filter(filtro)) filas.push(p);
  }
  console.log(`✍️  Optimizando ${filas.length} captions ${REELS ? '(SOLO reels/VIDEO)' : '(imágenes; reels excluidos)'}${DRY ? ' — DRY, 4 ejemplos' : ''}\n`);
  if (DRY) {
    for (const p of [filas[0], filas[Math.floor(filas.length / 3)], filas.find((x) => x.formato === 'OFERTA'), filas.find((x) => x.marca === 'Contratado')].filter(Boolean)) {
      const n = construir(p, filas.indexOf(p));
      console.log(`── ${p.marca} ${p.fecha.slice(5)}${p.slot || ''} ${p.formato} · ${(p.tema || '').slice(0, 40)}`);
      console.log(`ANTES: ${(p.copy || '(vacío)').replace(/\n/g, ' ').slice(0, 90)}`);
      console.log(`AHORA:\n${n.copy}\n${n.hashtags}\n`);
    }
    return;
  }
  let ok = 0;
  for (const p of filas) {
    const n = construir(p);
    const u = await fetch(`${SB}/rest/v1/contenido_social?id=eq.${p.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(n) });
    if (u.ok) ok++; else console.error('✗', p.id, await u.text());
  }
  console.log(`✅ ${ok}/${filas.length} captions optimizados. Corre rankearViralidad.mjs para el antes/después.`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
