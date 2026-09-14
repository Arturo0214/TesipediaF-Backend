// Banco de temas de VALOR para el contenido de redes de Contratado (contratado.com.mx).
// TODO gira alrededor de los PRODUCTOS REALES de la página (verificados en el código del proyecto):
//   • Analizador de CV GRATIS (/analizador-de-cv) — puntaje ATS 0-100 en 2 min, sin registro  ← lead magnet #1
//   • 10 plantillas de CV compatibles con ATS (/plantillas-de-cv) — editables, PDF/Word
//   • Adapta tu CV a la vacante con IA — $149 (/adapta-tu-cv)  ← producto estrella
//   • CV con IA $99 · Carta con IA $49 · Análisis a fondo con IA $79 · Combo CV+Carta $129
//   • Planes: CV Pro $399/mes · CV Pro + Global $699/mes (/pago)
//   • Guía Premium PDF $149 (/guias/guia-premium) · Vacantes reales (/vacantes)
// Voz: mexicana, experta, directa; datos reales; nunca "empleo garantizado". Handle @contratadomx.
// Lo usan septiembreContratado.mjs / reorientarContratado.mjs y generarRedesImg.mjs (--marca Contratado).

// Las 10 plantillas reales (nombre → perfil/rol de ejemplo) para contenido de plantillas.
export const PLANTILLAS = [
  { nombre: 'Doble Columna', rol: 'Analista de Datos', color: 'navy' },
  { nombre: 'Moderna', rol: 'Project Manager', color: 'verde' },
  { nombre: 'Clara', rol: 'Data Scientist', color: 'azul' },
  { nombre: 'Ejecutiva', rol: 'Director Comercial', color: 'rojo' },
  { nombre: 'Ivy League', rol: 'Ingeniero Senior', color: 'negro serif' },
  { nombre: 'Elegante', rol: 'Project Manager', color: 'navy' },
  { nombre: 'Creativa', rol: 'UX Designer', color: 'morado' },
  { nombre: 'Minimalista', rol: 'Contador', color: 'negro' },
  { nombre: 'Compacta', rol: 'Recursos Humanos', color: 'verde' },
  { nombre: 'Timeline', rol: 'Ing. de Operaciones', color: 'azul' },
];

// Catálogo de PRODUCTOS para las piezas de OFERTA (el generador rota este arreglo y arma un
// mockup visual del producto REAL con su precio y URL). Orden = prioridad de aparición
// (los lead magnets gratis y el producto estrella van primero y se repiten más).
export const PRODUCTOS = [
  { key: 'analizador', nombre: 'Analizador de CV', precio: 'GRATIS', url: 'contratado.com.mx/analizador-de-cv',
    promesa: 'Tu puntaje ATS en 2 minutos', badge: 'GRATIS · sin registro',
    bullets: ['Puntaje de 0 a 100', 'Te dice qué keywords te faltan', '100% privado: tu CV no se sube'],
    visual: 'un MOCKUP realista de la pantalla del analizador: un medidor circular de puntaje ATS marcando 82/100 en verde, una lista de checks (✓ keywords, ✓ formato) y un par de sugerencias resaltadas. Interfaz limpia estilo app web.' },
  { key: 'plantillas', nombre: '10 plantillas de CV', precio: 'GRATIS', url: 'contratado.com.mx/plantillas-de-cv',
    promesa: 'Plantillas ATS listas para editar', badge: '10 diseños · PDF y Word',
    bullets: ['Todas aprobadas por el filtro ATS', 'Editor en línea, vista previa en vivo', 'Elige por color, columnas y con/sin foto'],
    visual: 'un ABANICO/galería de 3-4 CVs distintos (una plantilla de doble columna navy, una moderna verde, una minimalista negra) mostrados como tarjetas, cada uno con una etiqueta "ATS ✓". Se ve variedad de diseños profesionales.' },
  { key: 'adaptacv', nombre: 'Adapta tu CV a la vacante', precio: '$149', url: 'contratado.com.mx/adapta-tu-cv',
    promesa: 'Tu CV reescrito para ESA vacante, con IA', badge: 'IA · pago único',
    bullets: ['La IA integra las keywords exactas de la oferta', 'Edítalo por secciones (más impacto, más ATS)', 'Listo en minutos, no en horas'],
    visual: 'un ANTES/DESPUÉS de un CV lado a lado: a la izquierda "ANTES" un CV genérico gris; a la derecha "DESPUÉS" el mismo CV optimizado con varias keywords resaltadas en verde y una insignia de match ATS subiendo. Flecha entre ambos.' },
  { key: 'analisis_ia', nombre: 'Análisis de CV a fondo con IA', precio: '$79', url: 'contratado.com.mx/analizador-de-cv',
    promesa: 'La IA te dice exactamente qué mejorar', badge: 'IA · pago único',
    bullets: ['Resumen ejecutivo de tu CV', 'Lista de mejoras priorizadas', 'Comparado contra el puesto que quieres'],
    visual: 'un MOCKUP de un reporte de IA sobre un CV: un panel con "Mejoras prioritarias" en una lista numerada, íconos de foco/alerta, y un puntaje. Estilo dashboard limpio.' },
  { key: 'plantillas', nombre: '10 plantillas de CV', precio: 'GRATIS', url: 'contratado.com.mx/plantillas-de-cv',
    promesa: 'Elige tu plantilla ATS y edítala en línea', badge: '10 diseños · gratis',
    bullets: ['Diseños por rol: datos, ventas, diseño, finanzas', 'Descarga en PDF o Word', 'Sin marca de agua con CV Pro'],
    visual: 'tres tarjetas de CV distintas en fila (doble columna, timeline azul, ejecutiva roja), cada una etiquetada con el rol ideal, sobre un fondo navy. Se ve profesional y variado.' },
  { key: 'analizador', nombre: 'Analizador de CV', precio: 'GRATIS', url: 'contratado.com.mx/analizador-de-cv',
    promesa: '¿Tu CV pasa el filtro ATS? Compruébalo gratis', badge: 'GRATIS · resultado en 2 min',
    bullets: ['El 75% de los CV muere en el ATS', 'Sabrás tu puntaje y qué corregir hoy', 'Sin registro, 100% privado'],
    visual: 'un teléfono/pantalla mostrando el analizador con un puntaje ATS bajo (54/100) en ámbar y alertas rojas de "keywords faltantes", transmitiendo urgencia de mejorar. UI de app moderna.' },
  { key: 'carta_ia', nombre: 'Carta de presentación con IA', precio: '$49', url: 'contratado.com.mx/carta-de-presentacion',
    promesa: 'Una carta personalizada en 5 segundos', badge: 'IA · pago único',
    bullets: ['Adaptada a la empresa y la vacante', 'Tres tonos: directo, formal o cercano', 'Sin partir de una hoja en blanco'],
    visual: 'un MOCKUP de una carta de presentación bien maquetada saliendo de un ícono de IA, con un par de frases resaltadas y el nombre de una empresa. Limpio y profesional.' },
  { key: 'combo', nombre: 'Combo CV + Carta con IA', precio: '$129', url: 'contratado.com.mx/adapta-tu-cv',
    promesa: 'Tu CV y tu carta optimizados, juntos', badge: 'IA · ahorra vs. por separado',
    bullets: ['CV adaptado a la vacante + carta a juego', 'Todo con las keywords del puesto', 'El paquete listo para postular'],
    visual: 'un CV y una carta de presentación juntos como un set/kit, atados con un moño o dentro de una carpeta, ambos con detalles resaltados. Composición tipo "paquete".' },
  { key: 'pro', nombre: 'CV Pro', precio: '$399/mes', url: 'contratado.com.mx/pago',
    promesa: 'Todo lo que necesitas para postular sin límites', badge: 'Suscripción · cancela cuando quieras',
    bullets: ['Descarga sin marca de agua (PDF+Word)', '10+ plantillas ATS + editor + carta', 'Guía de LinkedIn incluida'],
    visual: 'una tarjeta de plan "CV Pro $399/mes" estilo pricing card, con una lista de beneficios con palomitas verdes y un botón CTA. Fondo navy con acento verde.' },
  { key: 'pro_global', nombre: 'CV Pro + Global', precio: '$699/mes', url: 'contratado.com.mx/pago',
    promesa: 'Da el salto internacional', badge: 'Suscripción premium',
    bullets: ['Todo lo de Pro + tu CV en inglés', 'Perfil de LinkedIn optimizado', 'Todas las guías premium + soporte prioritario'],
    visual: 'una tarjeta de plan "CV Pro + Global $699/mes" premium con acento dorado/verde, un pin de globo terráqueo y beneficios con palomitas. Estilo pricing card elegante.' },
];

// Carruseles = guías completas que ENSEÑAN y llevan a un producto real (portada + tips numerados + cierre CTA).
export const CARRUSEL_TEMAS = [
  { titulo: 'Analiza tu CV gratis en 2 minutos (paso a paso)', guia: 'contratado.com.mx/analizador-de-cv',
    tips: ['Pega o sube tu CV en el analizador (no se guarda, es privado)', 'Escribe el puesto que buscas para medir el match', 'Recibe tu puntaje ATS de 0 a 100 al instante', 'Revisa qué keywords te faltan y qué frases sobran', 'Corrige y vuelve a medir hasta pasar el filtro'] },
  { titulo: 'Las 10 plantillas de CV de Contratado: ¿cuál es la tuya?', guia: 'contratado.com.mx/plantillas-de-cv',
    tips: ['¿Datos o finanzas? Doble Columna o Minimalista (sobrias)', '¿Diseño o marketing? Creativa (morada, con foto)', '¿Dirección o ventas? Ejecutiva (impacto y jerarquía)', '¿Perfil senior serio? Ivy League (1 columna, serif)', 'Todas son ATS-friendly: edítalas en línea y descárgalas'] },
  { titulo: 'Adapta tu CV a la vacante con IA en 5 pasos', guia: 'contratado.com.mx/adapta-tu-cv',
    tips: ['Sube tu CV actual y pega la oferta completa', 'La IA extrae las keywords y requisitos del puesto', 'Reescribe tus secciones alineadas a esa vacante', 'Ajusta el tono: más conciso, más impacto o más ATS', 'Descarga y postúlate el mismo día'] },
  { titulo: 'Cómo pasar el filtro ATS en 5 pasos', guia: 'contratado.com.mx/analizador-de-cv',
    tips: ['Usa las palabras EXACTAS de la vacante (keywords)', 'Formato simple: sin tablas, columnas raras ni imágenes', 'Encabezados estándar: Experiencia, Educación, Habilidades', 'Guarda en .docx o PDF con texto seleccionable (no imagen)', 'Antes de enviar, mide tu puntaje en el analizador gratis'] },
  { titulo: '5 errores que matan tu CV (y cómo arreglarlos)', guia: 'contratado.com.mx/analizador-de-cv',
    tips: ['Poner funciones en vez de LOGROS con números', 'Correo poco serio (usa nombre.apellido)', 'CV de 3 páginas: bájalo a 1-2 con lo relevante', 'Sin keywords de la vacante = te frena el ATS', 'Foto, edad y estado civil: en México ya no van'] },
  { titulo: 'Optimiza tu LinkedIn en 5 pasos', guia: 'contratado.com.mx/pago',
    tips: ['Headline con puesto + especialidad + resultado, no "Buscando oportunidades"', 'Foto profesional y banner que diga a qué te dedicas', 'Acerca de: 3 líneas de valor + logros con números', 'Activa "Open to work" y pide 2 recomendaciones', 'URL personalizada y publica 1 vez/semana'] },
  { titulo: 'CV sin experiencia: 5 formas de destacar', guia: 'contratado.com.mx/plantillas-de-cv',
    tips: ['Proyectos escolares y personales como experiencia', 'Habilidades y herramientas que ya dominas', 'Voluntariado y servicio social cuentan', 'Un objetivo claro dirigido a la vacante', 'Arranca de una plantilla ATS lista (no de cero)'] },
  { titulo: 'Método STAR: responde cualquier entrevista', guia: 'contratado.com.mx/guias',
    tips: ['Situación: el contexto en 1 frase', 'Tarea: cuál era tu responsabilidad', 'Acción: qué hiciste TÚ (no el equipo)', 'Resultado: el impacto con un número', 'Practica 3 historias STAR antes de cada entrevista'] },
  { titulo: 'Carta de presentación que sí leen: 5 claves', guia: 'contratado.com.mx/carta-de-presentacion',
    tips: ['Personalízala a la empresa y al puesto', 'Primer párrafo: por qué TÚ para ESTA vacante', 'Un logro relevante con número, no repitas el CV', 'Cierre con un llamado a la entrevista', 'Media página máximo: al reclutador no le sobra el tiempo'] },
  { titulo: 'Negociación salarial: 5 frases que suben tu oferta', guia: 'contratado.com.mx/guias',
    tips: ['"¿Cuál es el rango presupuestado para el puesto?"', '"Con base en el mercado, buscaba entre X y Y"', 'Nunca des la primera cifra si puedes evitarlo', 'Negocia el paquete completo, no solo el sueldo base', '"¿Hay flexibilidad en la oferta?" antes de aceptar'] },
];

// Estáticos: un tema específico por pieza (tip/dato accionable + CTA al producto real).
export const BANCOS = {
  FRASE: [
    'El 75% de los CV muere en un filtro ATS antes de que un humano lo lea. Mídelo gratis en 2 min → contratado.com.mx/analizador-de-cv',
    'Un CV de 1 página con logros gana a 3 páginas de funciones. Arranca de una plantilla ATS lista',
    'Cuantifica: "aumenté ventas" → "aumenté ventas 30% en 6 meses"',
    'No mandes el mismo CV a todas: adáptalo a cada vacante y multiplicas tus respuestas',
    'Verbos de impacto: lideré, aumenté, reduje, logré (no "responsable de")',
    'En México ya no va foto, edad ni estado civil en el CV',
    '¿No sabes si tu CV pasa el ATS? El analizador gratis te da tu puntaje en 2 minutos',
    'La keyword más importante es el título EXACTO del puesto que buscas',
    'Guarda tu CV en PDF con texto seleccionable, no como imagen: el ATS no lee imágenes',
    'La mejor plantilla es la más simple: sin columnas raras ni tablas que confunden al ATS',
  ],
  CHECKLIST: [
    'Tu CV pasa el ATS si cumple estos 5 (compruébalo gratis en Contratado)',
    'Antes de mandar tu CV, revisa estos 5 puntos',
    'Cómo elegir tu plantilla de CV en Contratado: 5 criterios',
    'LinkedIn listo para reclutadores: 5 puntos',
    'Prepárate para la entrevista en 5 pasos',
    'Antes de aceptar una oferta, checa estos 5',
  ],
  COMPARATIVA: [
    'Tu CV: así NO vs así SÍ (funciones vs logros con números)',
    'CV genérico vs CV adaptado a la vacante con IA',
    'CV en Word desde cero vs plantilla ATS de Contratado',
    'Headline de LinkedIn: así NO vs así SÍ',
    'Respuesta de entrevista: divagar vs método STAR',
    'Correo de seguimiento tras postular: así NO vs así SÍ',
  ],
  DICCIONARIO: [
    'ATS (Applicant Tracking System)', 'Keywords de vacante', 'Match ATS', 'Soft skills', 'Hard skills',
    'Screening', 'Headhunter', 'Employer branding',
  ],
  PRUEBA: [
    '12,438 personas ya crearon su CV con Contratado',
    '3,127 personas consiguieron entrevista el mes pasado con Contratado',
    'El 75% de los CV no pasan el filtro ATS: por eso existe el analizador gratis',
    '10 plantillas ATS + analizador gratis: todo para postular en un solo lugar',
  ],
  // OFERTA: el generador ignora este texto y rota el catálogo PRODUCTOS (mockup real + precio + URL);
  // estas líneas quedan solo como respaldo/caption si algo falla.
  OFERTA: [
    'Analizador de CV GRATIS: tu puntaje ATS en 2 minutos → contratado.com.mx/analizador-de-cv',
    '10 plantillas de CV ATS, gratis y editables → contratado.com.mx/plantillas-de-cv',
    'Adapta tu CV a la vacante con IA — $149 → contratado.com.mx/adapta-tu-cv',
    'CV con IA $99 · Carta con IA $49 · Combo $129 → contratado.com.mx/adapta-tu-cv',
    'CV Pro: plantillas sin marca + carta + LinkedIn — $399/mes → contratado.com.mx/pago',
  ],
  // Vacantes reales (se inyectan desde server/lib/vacantes.js al generar).
  VACANTE: [
    'Top 5 vacantes reales de la semana (ordenadas por afinidad en Contratado)',
    'Vacante del día: la que no te puedes perder',
    'Vacantes de gobierno (DOF): plazas bien pagadas',
    'Top empleos en tecnología esta semana',
    'Top empleos en administración y finanzas',
  ],
};

// Identidad de marca para el generador (Contratado).
export const MARCA_CFG = {
  marca: 'Contratado',
  logo: '/tmp/redes-brand/contratado-logo.png',
  slogan: 'Crea un CV que sí te contrata',
  handle: '@contratadomx',
  colores: 'azul marino #0A1D3A, azul #2563EB y VERDE acción #12C27A para los CTA',
  voz: 'mexicana, experta y directa; cero humo, con datos reales; nunca prometas "empleo garantizado"',
  nombre: 'Contratado',
  // Mascota/cara recurrente de la marca: personaje estilo Leonardo DiCaprio como Jordan
  // Belfort en "El Lobo de Wall Street" (carismático, de traje elegante, éxito y confianza).
  personaje: 'un personaje recurrente inspirado en Leonardo DiCaprio como Jordan Belfort en "El Lobo de Wall Street": hombre carismático de traje elegante, actitud de éxito, confianza y persuasión. Es la cara/mascota de Contratado; debe ser SIEMPRE el mismo personaje reconocible',
};
