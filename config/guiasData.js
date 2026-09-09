// Fuente única de datos de las guías de Tesipedia (doc maestro 2026-09-08).
// La usa: el script de subida a Cloudinary, el catálogo del backend y (copia) el frontend.
// Precios (doc): citación $139 · sección/carrera/búsqueda $79 · paquete completo $749.
// `folder` es la carpeta en Documents/.../Tesipedia-Guias con los PDFs (completa + _MUESTRA).

export const GUIAS_DATA = [
  // ── Serie núcleo (secciones + citación) ──
  {
    id: 'apa-7', sku: '01', tipo: 'citacion', precio: 139, folder: '01-APA',
    nombre: 'Cita bien, aprueba antes · APA 7', kicker: 'Normas APA 7',
    resumen: 'Normas APA 7.ª edición: citas en el texto, lista de referencias y formato del documento, con ejemplos listos y errores que reprueban.',
    blogSlug: 'formato-apa-7-edicion-tesis-guia-completa-ejemplos',
    extras: ['laminas-redes.zip', 'fuente-editable.zip'],
  },
  {
    id: 'planteamiento', sku: '02', tipo: 'seccion', precio: 79, folder: '02-Planteamiento',
    nombre: 'Del tema al problema · Planteamiento', kicker: 'Planteamiento del problema',
    resumen: 'Convierte un tema amplio en un problema de investigación acotado, con la pregunta bien formulada y ejemplos desarrollados.',
    blogSlug: 'como-hacer-planteamiento-del-problema-tesis-ejemplos',
  },
  {
    id: 'marco-teorico', sku: '03', tipo: 'seccion', precio: 79, folder: '03-Marco-teorico',
    nombre: 'Deja de resumir, empieza a discutir · Marco teórico', kicker: 'Marco teórico',
    resumen: 'Construye un marco teórico que discute y articula fuentes en lugar de resumirlas, con estructura y citación correcta.',
    blogSlug: 'como-hacer-marco-teorico-tesis-guia-paso-a-paso',
  },
  {
    id: 'objetivos', sku: '04', tipo: 'seccion', precio: 79, folder: '04-Objetivos',
    nombre: 'Un verbo bien elegido · Objetivos e hipótesis', kicker: 'Objetivos e hipótesis',
    resumen: 'Redacta objetivo general y específicos medibles, alineados con tu pregunta e hipótesis, con la taxonomía de verbos correcta.',
    blogSlug: 'objetivos-de-investigacion-como-redactarlos-ejemplos',
  },
  {
    id: 'justificacion', sku: '05', tipo: 'seccion', precio: 79, folder: '05-Justificacion',
    nombre: 'Por qué vale la pena · Justificación', kicker: 'Justificación',
    resumen: 'Argumenta la relevancia teórica, social y práctica de tu tesis con evidencia, sin caer en frases huecas.',
    blogSlug: 'justificacion-de-una-tesis-como-escribirla-ejemplos',
  },
  {
    id: 'metodologia', sku: '06', tipo: 'seccion', precio: 79, folder: '06-Metodologia',
    nombre: 'El capítulo que se replica · Metodología y variables', kicker: 'Metodología y variables',
    resumen: 'Diseña una metodología replicable: enfoque, variables operacionalizadas, instrumentos y muestra, paso a paso.',
    blogSlug: 'variables-de-investigacion-tipos-operacionalizacion-ejemplos',
  },
  {
    id: 'resultados', sku: '07', tipo: 'seccion', precio: 79, folder: '07-Analisis-resultados',
    nombre: 'De los datos a los hallazgos · Análisis y resultados', kicker: 'Análisis y resultados',
    resumen: 'Convierte tus datos en hallazgos: análisis en SPSS, R o Excel, tablas y figuras, e interpretación que responde tus objetivos.',
    blogSlug: 'analisis-de-datos-en-tu-tesis-spss-r-y-excel-explicados',
  },
  {
    id: 'conclusiones', sku: '08', tipo: 'seccion', precio: 79, folder: '08-Conclusiones',
    nombre: 'Cierra fuerte, defiende mejor · Discusión y conclusiones', kicker: 'Discusión y conclusiones',
    resumen: 'Escribe una discusión que dialoga con la literatura y conclusiones que responden tu pregunta, sin repetir resultados.',
    blogSlug: 'como-redactar-conclusiones-de-una-tesis-ejemplos',
  },
  {
    id: 'cronograma', sku: '09', tipo: 'seccion', precio: 79, folder: '09-Cronograma',
    nombre: 'Termina la tesis que ya empezaste · Cronograma', kicker: 'Cronograma',
    resumen: 'Organiza tu tiempo con un cronograma real por etapas y una plantilla para terminar la tesis que dejaste a medias.',
    blogSlug: 'cronograma-de-tesis-como-organizar-tu-tiempo-plantilla',
  },
  {
    id: 'defensa', sku: '10', tipo: 'seccion', precio: 79, folder: '10-Defensa',
    nombre: 'El día que sí se prepara · Defensa', kicker: 'Defensa de tesis',
    resumen: 'Prepara tu examen profesional: guion de exposición, diapositivas y simulación de las preguntas del sínodo.',
    blogSlug: 'tips-para-defender-tu-tesis-con-exito',
  },
  {
    id: 'vancouver', sku: '11', tipo: 'citacion', precio: 139, folder: '11-Vancouver',
    nombre: 'Cita como se cita en salud · Vancouver', kicker: 'Normas Vancouver',
    resumen: 'Estilo Vancouver para tesis de salud: citas numéricas, referencias y el formato que piden las revistas médicas.',
    blogSlug: null,
  },
  {
    id: 'chicago', sku: '12', tipo: 'citacion', precio: 139, folder: '12-Chicago',
    nombre: 'La nota al pie, bien puesta · Chicago', kicker: 'Normas Chicago',
    resumen: 'Estilo Chicago: notas al pie, bibliografía y las dos variantes (notas y autor-fecha) con ejemplos.',
    blogSlug: null,
  },
  {
    id: 'busqueda-literatura', sku: '13', tipo: 'seccion', precio: 79, folder: '13-Busqueda-articulos',
    nombre: 'Encuentra el artículo que sí existe · Búsqueda de literatura', kicker: 'Búsqueda de literatura',
    resumen: 'Busca y organiza fuentes académicas reales: operadores, bases de datos, gestores de referencias y cómo descartar lo que no sirve.',
    blogSlug: 'revision-de-literatura-como-buscar-y-organizar-fuentes-academicas',
  },

  // ── Serie por carrera (todas $79) ──
  { id: 'tesis-medicina', sku: 'C1', tipo: 'carrera', precio: 79, folder: 'C1-Medicina', nombre: 'La tesis del médico', kicker: 'Tesis de Medicina', resumen: 'Guía de tesis para Medicina: 60 temas con población y diseño sugerido, protocolo clínico y estilo Vancouver.', careerLanding: '/tesis-de-medicina' },
  { id: 'tesis-enfermeria', sku: 'C2', tipo: 'carrera', precio: 79, folder: 'C2-Enfermeria', nombre: 'La tesis de enfermería', kicker: 'Tesis de Enfermería', resumen: 'Guía de tesis para Enfermería: 60 temas con población y diseño, enfoque de cuidado y evidencia.', careerLanding: '/tesis-de-enfermeria' },
  { id: 'tesis-derecho', sku: 'C3', tipo: 'carrera', precio: 79, folder: 'C3-Derecho', nombre: 'La tesis del abogado', kicker: 'Tesis de Derecho', resumen: 'Guía de tesis para Derecho: 60 temas con enfoque dogmático y de caso, metodología jurídica y fuentes.', careerLanding: '/tesis-de-derecho' },
  { id: 'tesis-psicologia', sku: 'C4', tipo: 'carrera', precio: 79, folder: 'C4-Psicologia', nombre: 'La tesis del psicólogo', kicker: 'Tesis de Psicología', resumen: 'Guía de tesis para Psicología: 60 temas con población y diseño, instrumentos validados y APA.', careerLanding: '/tesis-de-psicologia' },
  { id: 'tesis-administracion', sku: 'C5', tipo: 'carrera', precio: 79, folder: 'C5-Administracion', nombre: 'La tesis del administrador', kicker: 'Tesis de Administración', resumen: 'Guía de tesis para Administración: 60 temas de caso y campo, con diseño y variables de negocio.', careerLanding: '/tesis-de-administracion' },
  { id: 'tesis-contaduria', sku: 'C6', tipo: 'carrera', precio: 79, folder: 'C6-Contaduria', nombre: 'La tesis del contador', kicker: 'Tesis de Contaduría', resumen: 'Guía de tesis para Contaduría: 60 temas fiscales y financieros, con metodología cuantitativa aplicada.', careerLanding: '/tesis-de-contaduria' },
  { id: 'tesis-pedagogia', sku: 'C7', tipo: 'carrera', precio: 79, folder: 'C7-Pedagogia', nombre: 'La tesis del educador', kicker: 'Tesis de Pedagogía', resumen: 'Guía de tesis para Pedagogía y Educación: 60 temas con población escolar y diseño mixto.', careerLanding: '/tesis-de-pedagogia' },
  { id: 'tesis-ing-industrial', sku: 'C8', tipo: 'carrera', precio: 79, folder: 'C8-Ing-industrial', nombre: 'La tesis del ingeniero', kicker: 'Tesis de Ing. Industrial', resumen: 'Guía de tesis para Ingeniería Industrial: 60 temas de proceso y mejora, con diseño experimental.', careerLanding: '/tesis-de-ingenieria-industrial' },
  { id: 'tesis-mercadotecnia', sku: 'C9', tipo: 'carrera', precio: 79, folder: 'C9-Mercadotecnia', nombre: 'La tesis del mercadólogo', kicker: 'Tesis de Mercadotecnia', resumen: 'Guía de tesis para Mercadotecnia: 60 temas de consumidor y marca, con instrumentos y muestreo.', careerLanding: '/tesis-de-mercadotecnia' },
  { id: 'tesis-trabajo-social', sku: 'C10', tipo: 'carrera', precio: 79, folder: 'C10-Trabajo-social', nombre: 'La tesis del trabajo social', kicker: 'Tesis de Trabajo Social', resumen: 'Guía de tesis para Trabajo Social: 60 temas comunitarios, con diseño cualitativo e intervención.', careerLanding: '/tesis-de-trabajo-social' },
  { id: 'tesis-comunicacion', sku: 'C11', tipo: 'carrera', precio: 79, folder: 'C11-Comunicacion', nombre: 'La tesis del comunicólogo', kicker: 'Tesis de Comunicación', resumen: 'Guía de tesis para Comunicación: 60 temas de medios y discurso, con análisis de contenido.', careerLanding: '/tesis-de-comunicacion' },
  { id: 'tesis-arquitectura', sku: 'C12', tipo: 'carrera', precio: 79, folder: 'C12-Arquitectura', nombre: 'La tesis del arquitecto', kicker: 'Tesis de Arquitectura', resumen: 'Guía de tesis para Arquitectura: 60 temas de proyecto y ciudad, con metodología proyectual.', careerLanding: '/tesis-de-arquitectura' },

  // ── Serie por universidad (trámite de titulación; $99, UVM $79) ──
  { id: 'tesis-unam', sku: 'U1', tipo: 'universidad', precio: 99, folder: 'U1-UNAM', nombre: 'Titularte en la UNAM', kicker: 'Titulación UNAM', resumen: 'El trámite de titulación de la UNAM entendido de una vez: del registro del tema a la firma del acta, con formatos, plazos y las diferencias por facultad. 10 módulos + 4 anexos.', universityLanding: '/tesis-unam' },
  { id: 'tesis-ipn', sku: 'U2', tipo: 'universidad', precio: 99, folder: 'U2-IPN', nombre: 'Titularte en el Poli (IPN)', kicker: 'Titulación IPN', resumen: 'El trámite de titulación del IPN paso a paso: opciones por escuela, requisitos, expediente de documentos y examen profesional, con fechas y ventanillas.', universityLanding: '/tesis-ipn' },
  { id: 'tesis-udg', sku: 'U3', tipo: 'universidad', precio: 99, folder: 'U3-UdeG', nombre: 'Titularte en la UdeG', kicker: 'Titulación UdeG', resumen: 'La titulación en la Universidad de Guadalajara: modalidades por centro universitario, requisitos, documentos y tiempos del trámite.', universityLanding: '/tesis-udg' },
  { id: 'tesis-uanl', sku: 'U4', tipo: 'universidad', precio: 99, folder: 'U4-UANL', nombre: 'Titularte en la UANL, facultad por facultad', kicker: 'Titulación UANL', resumen: 'La UANL no tiene reglamento general de titulación: cada facultad publica el suyo. Esta guía te lleva por tu facultad, con opciones, documentos y examen.', universityLanding: '/tesis-uanl' },
  { id: 'tesis-buap', sku: 'U5', tipo: 'universidad', precio: 99, folder: 'U5-BUAP', nombre: 'Titularte en la BUAP', kicker: 'Titulación BUAP', resumen: 'El trámite de titulación de la BUAP: opciones, requisitos, expediente y examen profesional, con las diferencias por unidad académica.', universityLanding: '/tesis-buap' },
  { id: 'tesis-uv', sku: 'U6', tipo: 'universidad', precio: 99, folder: 'U6-UV', nombre: 'Titularte en la UV', kicker: 'Titulación UV', resumen: 'La titulación en la Universidad Veracruzana: modalidades por región y facultad, documentos, tiempos y examen del proceso.', universityLanding: '/tesis-uv' },
  { id: 'tesis-uaemex', sku: 'U7', tipo: 'universidad', precio: 99, folder: 'U7-UAEMex', nombre: 'Titularte en la UAEMéx', kicker: 'Titulación UAEMéx', resumen: 'El trámite de evaluación profesional de la UAEMéx: opciones de titulación, requisitos, documentos y examen, con sus tiempos.', universityLanding: '/tesis-uaemex' },
  { id: 'tesis-uam', sku: 'U8', tipo: 'universidad', precio: 99, folder: 'U8-UAM', nombre: 'Tu proyecto terminal en la UAM', kicker: 'Proyecto terminal UAM', resumen: 'En la UAM el título de licenciatura se obtiene con proyecto terminal, no con tesis. Esta guía cubre ese proceso: registro, documentos y presentación.', universityLanding: '/tesis-uam' },
  { id: 'tesis-tec', sku: 'U9', tipo: 'universidad', precio: 99, folder: 'U9-Tec', nombre: 'La tesis de posgrado en el Tec', kicker: 'Tesis posgrado Tec', resumen: 'En el Tec de Monterrey la tesis vive en posgrado. Guía del proceso de tesis de maestría y doctorado: comité, protocolo, avances y defensa.', universityLanding: '/tesis-tec-monterrey' },
  { id: 'tesis-unitec', sku: 'U10', tipo: 'universidad', precio: 99, folder: 'U10-UNITEC', nombre: 'Titularte en la UNITEC', kicker: 'Titulación UNITEC', resumen: 'El trámite de titulación de la UNITEC: opciones, requisitos, documentos y examen, con los tiempos de cada campus.', universityLanding: '/tesis-unitec' },
  { id: 'tesis-uvm', sku: 'U11', tipo: 'universidad', precio: 79, folder: 'U11-UVM', nombre: 'Titularte en la UVM', kicker: 'Titulación UVM', resumen: 'El reglamento de titulación de la UVM no es público. Esta guía se apoya en el marco legal de la SEP para exigir el documento a tu campus, con un guion de correo listo para usar.', universityLanding: '/tesis-uvm' },
];

// Paquetes (doc §2). Contenido = ids de guías incluidas. Precio siempre 25-35% abajo de la suma.
export const PAQUETES_DATA = [
  { id: 'paq-arranque', tipo: 'paquete', precio: 179, nombre: 'Paquete Arranque', kicker: 'Paquete', resumen: 'Planteamiento + Objetivos + Justificación. Para quien apenas registra tema.', incluyeIds: ['planteamiento', 'objetivos', 'justificacion'] },
  { id: 'paq-escritura', tipo: 'paquete', precio: 259, nombre: 'Paquete Escritura', kicker: 'Paquete', resumen: 'Marco teórico + Metodología + APA 7. Para quien ya tiene protocolo aprobado.', incluyeIds: ['marco-teorico', 'metodologia', 'apa-7'] },
  { id: 'paq-cierre', tipo: 'paquete', precio: 199, nombre: 'Paquete Cierre', kicker: 'Paquete', resumen: 'Resultados + Conclusiones + Defensa. Para quien va a examen este semestre.', incluyeIds: ['resultados', 'conclusiones', 'defensa'] },
  { id: 'paq-citacion', tipo: 'paquete', precio: 299, nombre: 'Paquete Citación', kicker: 'Paquete', resumen: 'APA 7 + Vancouver + Chicago. Para escuelas que cambian de estilo y asesores.', incluyeIds: ['apa-7', 'vancouver', 'chicago'] },
  { id: 'paq-salud', tipo: 'paquete', precio: 269, nombre: 'Paquete Salud', kicker: 'Paquete', resumen: 'Vancouver + Metodología + Búsqueda de literatura + tesis del área de salud.', incluyeIds: ['vancouver', 'metodologia', 'busqueda-literatura', 'tesis-medicina'] },
  {
    id: 'paq-completo', tipo: 'paquete', precio: 749, nombre: 'Paquete Completo del Taller de Tesis', kicker: 'Mejor valor',
    resumen: 'Las 13 guías del taller de tesis (del planteamiento a la defensa, con APA 7, Vancouver y Chicago). El plan para empezar desde cero.',
    incluyeIds: ['apa-7', 'planteamiento', 'marco-teorico', 'objetivos', 'justificacion', 'metodologia', 'resultados', 'conclusiones', 'cronograma', 'defensa', 'vancouver', 'chicago', 'busqueda-literatura'],
    destacado: true,
  },
];

export const getGuiaById = (id) => GUIAS_DATA.find((g) => g.id === id) || null;
export const getGuiaByBlogSlug = (slug) => GUIAS_DATA.find((g) => g.blogSlug === slug) || null;
export const getPaqueteById = (id) => PAQUETES_DATA.find((p) => p.id === id) || null;
