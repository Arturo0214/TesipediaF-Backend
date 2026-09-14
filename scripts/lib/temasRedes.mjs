// Identidad de marca para el generador (Tesipedia).
export const MARCA_CFG = {
  marca: 'Tesipedia',
  logo: '/tmp/redes-brand/tesipedia-logo.png',
  slogan: 'tu tesis, más fácil',
  handle: '@tesipediaoficial',
  colores: 'azul marino, blanco y ámbar',
  voz: 'cercana, directa, mexicana; enseña con ejemplos, cero humo',
  nombre: 'Tesipedia',
};

// Banco de temas de VALOR para el contenido de redes de Tesipedia.
// Lo usan: calendarioValor.mjs (asigna un tema distinto por slot) y generarRedesImg.mjs
// (genera la imagen desde el tema). Objetivo: que NADA se repita y todo enseñe algo concreto.

// Carruseles = guías completas (portada + tips numerados + cierre con CTA a la guía).
export const CARRUSEL_TEMAS = [
  { titulo: '5 reglas de APA 7 que sí reprueban tu tesis', guia: 'tesipedia.com/guias/apa-7',
    tips: ['Usa «et al.» desde la PRIMERA cita cuando son 3 o más autores', 'Cita textual de +40 palabras: en bloque con sangría y SIN comillas', 'Toda cita lleva página: (Autor, año, p. 45)', 'Referencias en orden alfabético y con sangría francesa', 'Cada cita en el texto debe tener su referencia (y viceversa)'] },
  { titulo: 'Cómo estructurar una tesis de Medicina (formato IMRyD)', guia: 'tesipedia.com/guias/tesis-medicina',
    tips: ['Introducción: del problema clínico a tu pregunta e hipótesis', 'Métodos: diseño, población, variables y consideraciones éticas', 'Resultados: tablas y figuras claras, sin interpretar aún', 'Discusión: compara con la literatura y reconoce limitaciones'] },
  { titulo: 'Marco teórico en 5 pasos: deja de resumir', guia: 'tesipedia.com/guias/marco-teorico',
    tips: ['Mapea los conceptos clave que sostienen tu pregunta', 'Por cada concepto, contrasta 2 autores que difieran', 'Toma postura: «para efectos de esta investigación…»', 'Conecta la teoría con TUS variables, no la dejes suelta', 'Cierra con un modelo o esquema que resuma tu marco'] },
  { titulo: 'Cómo elegir tu metodología (cuali, cuanti o mixta)', guia: 'tesipedia.com/guias/metodologia',
    tips: ['Parte de tu objetivo, no de lo que esté de moda', 'Cuantitativa: medir y comparar. Cualitativa: comprender a fondo', 'Define población, muestra y cómo calculas su tamaño', 'Asigna una técnica de análisis a CADA objetivo'] },
  { titulo: '5 errores al plantear el problema de investigación', guia: 'tesipedia.com/guias/planteamiento',
    tips: ['Confundir el tema amplio con el problema concreto', 'No poner una cifra con fuente que muestre la magnitud', 'No delimitar población, lugar y periodo', 'No decir qué pasa (el costo) si nadie lo estudia', 'No cerrar con una pregunta de investigación clara'] },
  { titulo: 'Objetivos de tesis: cómo redactarlos bien', guia: 'tesipedia.com/guias/objetivos',
    tips: ['Empieza con un verbo medible (analizar, comparar, determinar)', 'El objetivo general responde directamente a tu pregunta', 'Deja 3-4 específicos; no metas técnicas disfrazadas', 'Cada objetivo debe poder demostrarse con un dato'] },
  { titulo: 'Herramientas gratis para tu tesis y cómo usarlas', guia: 'tesipedia.com/guias/busqueda-literatura',
    tips: ['Zotero: guarda fuentes y cita en un clic', 'Google Académico + filtro por años para llegar al paper', 'Elicit: resume y compara papers según tu pregunta', 'Connected Papers: mapa visual de literatura relacionada'] },
  { titulo: 'Defensa de tesis: 4 preguntas que sí te hará el jurado', guia: 'tesipedia.com/guias/defensa',
    tips: ['¿Por qué este diseño y no otro? Justifícalo', '¿A quién representa tu muestra? Alcance y límites', '¿Para qué sirve tu hallazgo? Quién decide con él', '¿Cuáles son tus limitaciones? Reconócelas tú primero'] },
  { titulo: 'Cómo citar en Normas Vancouver (para ciencias de la salud)', guia: 'tesipedia.com/guias/vancouver',
    tips: ['Numera las citas en el ORDEN en que aparecen', 'En el texto van en superíndice o entre paréntesis', 'Referencias en orden numérico, no alfabético', 'Abrevia las revistas según el Index Medicus'] },
  { titulo: 'Cómo hacer la justificación de tu tesis', guia: 'tesipedia.com/guias/justificacion',
    tips: ['Nombra al beneficiario concreto de tu estudio', 'Di qué decisión se tomará con tu resultado', 'Separa relevancia teórica, social y práctica', 'Evita frases que sirvan para cualquier tesis'] },
  { titulo: 'Cronograma de tesis realista (que sí vas a cumplir)', guia: 'tesipedia.com/guias/cronograma',
    tips: ['Planea por entregables, no por capítulos gigantes', 'Deja holgura para las correcciones del asesor', 'Ten dos: el formal del protocolo y el real', 'Revisa y ajusta cada semana, no al final'] },
  { titulo: 'Antiplagio: cómo parafrasear bien y no calcar', guia: 'tesipedia.com/guias/apa-7',
    tips: ['Lee, CIERRA la fuente y escribe de memoria', 'Parafrasear NO es cambiar sinónimos', 'Aun parafraseando, se cita la fuente', 'Audita cita por cita, no solo el % de Turnitin'] },
];

// Estáticos: un tema específico por pieza. Cada uno enseña o vende algo concreto y distinto.
export const BANCOS = {
  FRASE: [
    'Nombra tus archivos con la fecha al inicio (2026-09-11_cap2) para no perder versiones',
    'Arranca escribiendo 150 palabras feas; editar es otro día',
    'Técnica Pomodoro 25-5: enfoque real sin agotarte',
    'Convierte «avanzar la tesis» en un entregable concreto del día',
    'Pide feedback accionable: que el asesor te dé 3 ejemplos concretos',
    'Cierra el documento en la tarea exacta de mañana para retomar sin fricción',
    'Acota en vez de cambiar de tema: menos población, menos tiempo, una variable',
    'Lee tu texto en voz alta para detectar lo que suena robótico',
    'Una fuente a la vez: no abras la siguiente hasta fichar la actual',
    'Arma una matriz de literatura: una fila por texto (cita, idea, método, hallazgo)',
    'Mide tu avance por entregables cerrados, no por horas sentado',
    'Bloque de 90 minutos con UNA sola tarea concreta',
    'Respalda y nombra tus archivos antes de cerrar el fin de semana',
    'Ponle fecha de entrega al asesor: el cierre es decisión, no inspiración',
  ],
  DICCIONARIO: [
    'Marco teórico', 'Operacionalizar variables', 'Muestra representativa', 'Turnitin',
    'Paráfrasis', 'Abstract (resumen)', 'Estado del arte', 'Variable', 'Sínodo / jurado',
    'Antecedente', 'Hipótesis', 'Cronograma', 'Saturación teórica', 'Triangulación',
  ],
  CHECKLIST: [
    'Tu planteamiento sirve si responde estas 5 preguntas',
    'Tu instrumento es válido si cumple estas 5',
    'Tu muestra está lista si tiene estos 5 elementos',
    'Tu capítulo 3 (metodología) está completo si tiene estos 5',
    '5 revisiones de 5 minutos antes de entregar',
    'Tus objetivos son medibles si pasan estos 5 filtros',
    'Referencias APA sin errores: checa estos 5 puntos',
    'Prepárate para la defensa con estos 5 pasos',
  ],
  COMPARATIVA: [
    'Citas en APA 7: así NO vs así SÍ',
    'Tablas y figuras en APA 7: así NO vs así SÍ',
    'Texto que suena a IA vs texto humano',
    'Parafrasear mal vs parafrasear bien',
    'Objetivos vagos vs objetivos medibles',
    'Redacción coloquial vs redacción académica',
    'Elegir la prueba estadística: así NO vs así SÍ',
  ],
  PRUEBA: [
    '+3,000 titulados con asesoría de Tesipedia',
    'De «no paso del capítulo 2» a titulada en 4 meses',
    'Asesoramos por especialidad: cada carrera tiene su norma y método',
    'Este mes ayudamos a cerrar decenas de tesis',
  ],
  OFERTA: [
    'Asesoría integral de tesis: acompañamiento de principio a fin',
    'Corrección de estilo y formato APA/Vancouver',
    'Apoyo en metodología y análisis de datos (SPSS/Atlas.ti)',
    'Diagnóstico gratis: dinos en qué parte estás atorado',
    'Asesoría por carrera: medicina, derecho, psicología, administración y más',
  ],
};
