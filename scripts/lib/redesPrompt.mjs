// Construye el prompt para ChatGPT (navegador) que genera el CONTENIDO de las piezas
// de redes de Tesipedia. NO lo genera Claude: lo genera la cuenta de ChatGPT del usuario.
// Devuelve un solo mensaje que pide un ARRAY JSON (una entrada por slot pendiente).
import { GUIAS_DATA } from '../../config/guiasData.js';

const GUIAS = GUIAS_DATA.map((g) => `${g.kicker} → tesipedia.com/guias/${g.id} ($${g.precio})`);

// Reglas por formato (heredadas del esquema editorial ya probado en rewriteContent.js)
export const REGLAS = {
  FRASE: 'Gancho relatable/honesto de tesista PERO que deje una idea útil o mini-tip. laminas=[].',
  DICCIONARIO: 'titular = «Palabra.<br>m. definición con humor de tesista que deja una verdad útil». laminas=[].',
  CHECKLIST: 'titular corto en MAYÚSCULAS (usa *asteriscos* para 1 palabra resaltada). laminas = 5 ítems, cada uno «Título corto · detalle accionable concreto».',
  COMPARATIVA: 'titular corto. laminas = 4-5, cada una EXACTAMENTE «MAL · ejemplo concreto → BIEN · ejemplo concreto».',
  CARRUSEL: 'titular = portada con gancho (usa *asteriscos* para resaltar 1 palabra). laminas = 4-6, cada una «Título corto · tip accionable con mini-ejemplo».',
  PRUEBA: 'titular = dato/beneficio corto y contundente (ej. «+3,000<br>TITULADOS»). laminas=[]. Prueba social creíble, sin inventar cifras exactas no verificables.',
  OFERTA: 'titular = oferta clara de la ASESORÍA (jamás «hacemos tu tesis»). laminas=[]. copy dice qué recibe y cómo pedirlo por WhatsApp/DM.',
};

const SYSTEM = `Eres el mejor creador de contenido educativo sobre TESIS para redes en México (nivel @mister_investigacion). Tu contenido ENSEÑA algo concreto y accionable: siempre das el CÓMO con especificidad y ejemplos, NUNCA solo nombras el concepto. Voz Tesipedia: cercana, directa, mexicana, cero humo, cero clickbait vacío. Tesipedia es ASESORÍA de tesis (jamás digas "hacemos tu tesis"). Promueve de forma natural las guías y la página tesipedia.com. Español de México. Sin markdown dentro de los campos, sin comillas tipográficas raras.`;

// slots: [{ id, dia, slot, fecha, formato, tema, pilar }]
export function construirPrompt(slots) {
  const lista = slots.map((s, i) => `#${i + 1} · id=${s.id} · ${s.fecha} · formato=${s.formato} · tema=${s.tema || '(libre)'} · pilar=${s.pilar || '(libre)'}
   Regla: ${REGLAS[s.formato] || 'Aporta valor concreto y accionable.'}`).join('\n');

  return `${SYSTEM}

GUÍAS DE TESIPEDIA (para promocionar cuando encaje con el tema; usa la URL tal cual):
${GUIAS.map((g) => '· ' + g).join('\n')}

TAREA: genera ${slots.length} piezas de contenido para Instagram/Facebook, una por cada slot de abajo. Deben ser consistentes entre sí y con la marca, enseñar algo real y, cuando el tema lo permita, invitar a la guía correspondiente o a escribir por WhatsApp para asesoría.

CALIDAD Y VARIEDAD (obligatorio): cada pieza debe tener un gancho DISTINTO y un tip ACCIONABLE diferente; no repitas aperturas, estructuras ni ejemplos entre piezas; evita clichés y frases de relleno. Si dos slots comparten tema (p. ej. dos «mitad de semana»), abórdalos desde ángulos claramente distintos. Da siempre el CÓMO con un mini-ejemplo concreto.

SLOTS:
${lista}

Para CADA slot devuelve un objeto con EXACTAMENTE estos campos:
- "id": el id numérico del slot (cópialo tal cual).
- "titular": gancho principal; usa el token <br> para separar líneas (2-4 líneas); envuelve en *asteriscos* la palabra a resaltar (una sola). Respeta la regla del formato.
- "laminas": array de strings (vacío [] si el formato no lo pide).
- "copy": pie de foto de 2-4 frases que APORTEN (no repitan el titular) y cierren con una invitación suave (guía o DM). Incluye la URL de la guía si aplica.
- "cta": 3-5 palabras (texto del botón).
- "hashtags": string con 8-12 hashtags relevantes y en tendencia para tesistas en México, separados por espacio, empezando con #. Mezcla nicho (#tesis #metodologia) y alcance (#universidad #estudiantesmexico).

REGLAS PARA QUE EL JSON SEA VÁLIDO (MUY IMPORTANTE):
- Cada valor va en UNA sola línea física: NUNCA metas saltos de línea reales dentro de un valor; usa el token <br> para los saltos visuales.
- NUNCA uses comillas dobles (") dentro de los textos; si necesitas comillas usa « » o ' '.
- No inventes cifras falsas; si citas un número, que sea plausible y general.
- No uses markdown dentro de los valores (solo <br> y *asteriscos* como se indicó).
- Devuelve SOLO el ARRAY JSON con ${slots.length} objetos, sin texto antes ni después:

\`\`\`json
[ { "id": 0, "titular": "Línea 1<br>Línea 2 con *palabra*", "laminas": [], "copy": "...", "cta": "...", "hashtags": "#..." } ]
\`\`\``;
}

// Valida/normaliza una entrada devuelta por ChatGPT
export function validarPieza(o, slot) {
  const err = [];
  if (!o || typeof o !== 'object') return { ok: false, err: ['no es objeto'] };
  const titular = String(o.titular || '').trim();
  if (titular.length < 6) err.push('titular vacío/corto');
  const laminas = Array.isArray(o.laminas) ? o.laminas.map((x) => String(x).trim()).filter(Boolean) : [];
  if ((slot.formato === 'CHECKLIST' || slot.formato === 'COMPARATIVA' || slot.formato === 'CARRUSEL') && laminas.length < 3)
    err.push(`${slot.formato} requiere >=3 láminas (tiene ${laminas.length})`);
  const copy = String(o.copy || '').trim();
  if (copy.length < 20) err.push('copy vacío/corto');
  let hashtags = String(o.hashtags || '').trim();
  const nTags = (hashtags.match(/#/g) || []).length;
  if (nTags < 5) err.push(`pocos hashtags (${nTags})`);
  return {
    ok: err.length === 0,
    err,
    pieza: { id: slot.id, formato: slot.formato, tema: slot.tema, titular, laminas, copy, cta: String(o.cta || '').trim() || 'Escríbenos por DM', hashtags },
  };
}
