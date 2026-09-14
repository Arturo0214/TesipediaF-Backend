// Renderer de tarjetas de marca Tesipedia — 100% en proceso (satori → SVG → sharp → PNG).
// Sin fuentes del sistema (glifos embebidos): corre igual en local que en Railway.
// Identidad: navy #071A3A + azul #2563EB + ámbar #F5B301 + papel #F4F7FB, verde CTA #16A34A.
// Estáticos → 9:16 (1080×1920). Carrusel → 4:5 (1080×1350), estándar de feed IG.
//
// Uso:
//   import { renderPieza } from './lib/redesRender.mjs'
//   const pngs = await renderPieza({ formato:'FRASE', titular, laminas, copy, cta, tema })
//   // → [Buffer] (1 para estáticos, N para carrusel)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';

const DIR = dirname(fileURLToPath(import.meta.url));
const font = (f) => readFileSync(resolve(DIR, '../../assets/fonts', f));

const FONTS = [
  { name: 'Inter', data: font('Inter-Regular.ttf'), weight: 400, style: 'normal' },
  { name: 'Inter', data: font('Inter-SemiBold.ttf'), weight: 600, style: 'normal' },
  { name: 'Inter', data: font('Inter-ExtraBold.ttf'), weight: 800, style: 'normal' },
];

export const MARCA = {
  navy: '#071A3A', navy2: '#0E2A5C', azul: '#2563EB', azulSuave: '#EAF1FE',
  ambar: '#F5B301', papel: '#F4F7FB', papel2: '#E9EFF7', tinta: '#0F172A',
  gris: '#64748B', verde: '#16A34A', linea: '#E2E8F0', blanco: '#FFFFFF',
};

// Etiqueta legible de cada tema/guía para el pill de categoría
const PILL = {
  Cronograma: 'CRONOGRAMA', 'APA 7': 'APA 7', Objetivos: 'OBJETIVOS',
  'Marco teórico': 'MARCO TEÓRICO', Metodología: 'METODOLOGÍA',
  Planteamiento: 'PLANTEAMIENTO', Conclusiones: 'CONCLUSIONES',
  Justificación: 'JUSTIFICACIÓN', Defensa: 'DEFENSA', Resultados: 'RESULTADOS',
};

// ── Mini-DSL para satori ──
const h = (type, style, ...children) => ({ type, props: { style, children: children.length === 1 ? children[0] : children } });
const div = (style, ...c) => h('div', { display: 'flex', ...style }, ...c);
const txt = (style, s) => h('div', { display: 'flex', ...style }, String(s ?? ''));

// ── Logo wordmark TESIPEDIA (birrete + palabra) ──
function logo() {
  return div({ alignItems: 'center', gap: 14 },
    div({ width: 46, height: 46, borderRadius: 12, backgroundColor: MARCA.navy, alignItems: 'center', justifyContent: 'center' },
      txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 26, color: MARCA.ambar }, 'T')),
    txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 34, letterSpacing: 1, color: MARCA.navy }, 'TESIPEDIA'),
  );
}

// ── Header: logo + pill de categoría ──
function header(tema) {
  const label = PILL[tema] || (tema ? String(tema).toUpperCase() : 'TESIS');
  return div({ alignItems: 'center', justifyContent: 'space-between', width: '100%' },
    logo(),
    div({ paddingTop: 12, paddingBottom: 12, paddingLeft: 24, paddingRight: 24, borderRadius: 999, border: `2px solid ${MARCA.azul}`, backgroundColor: MARCA.azulSuave },
      txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, letterSpacing: 1.5, color: MARCA.azul }, label)),
  );
}

// ── Footer: handle + CTA ──
function footer(cta) {
  return div({ alignItems: 'center', justifyContent: 'space-between', width: '100%' },
    txt({ fontFamily: 'Inter', fontWeight: 600, fontSize: 24, color: MARCA.gris }, '@tesipediaoficial · tesipedia.com'),
    div({ paddingTop: 16, paddingBottom: 16, paddingLeft: 30, paddingRight: 30, borderRadius: 999, backgroundColor: MARCA.verde },
      txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 24, color: MARCA.blanco }, cta || 'Escríbenos por DM')),
  );
}

// Divide el titular en líneas (respeta \n; resalta la palabra entre *asteriscos* o la 2ª línea)
function titularBloque(titular, size = 92) {
  const lineas = String(titular || '').split('\n');
  return div({ flexDirection: 'column', gap: 4 },
    ...lineas.map((ln) => {
      const m = ln.match(/^(.*?)\*(.+?)\*(.*)$/);
      if (m) {
        const pre = m[1].replace(/\s+$/, ''), post = m[3].replace(/^\s+/, '');
        return div({ alignItems: 'baseline', flexWrap: 'wrap' },
          pre ? txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: size, color: MARCA.navy, lineHeight: 1.05, marginRight: '0.28em' }, pre) : null,
          txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: size, color: MARCA.azul, lineHeight: 1.05, borderBottom: `6px solid ${MARCA.ambar}` }, m[2]),
          post ? txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: size, color: MARCA.navy, lineHeight: 1.05, marginLeft: '0.28em' }, post) : null);
      }
      return txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: size, color: MARCA.navy, lineHeight: 1.05 }, ln);
    }),
  );
}

// ── Cuerpos por formato ──
function cuerpoFrase(p) {
  return div({ flexDirection: 'column', justifyContent: 'center', flexGrow: 1, gap: 40 },
    titularBloque(p.titular, 104),
    txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 40, color: MARCA.tinta, lineHeight: 1.4 }, p.copy || ''));
}

function cuerpoDiccionario(p) {
  const [palabra, ...resto] = String(p.titular || '').split('\n');
  return div({ flexDirection: 'column', justifyContent: 'center', flexGrow: 1, gap: 28 },
    txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 40, letterSpacing: 3, color: MARCA.azul }, 'DICCIONARIO DEL TESISTA'),
    txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 108, color: MARCA.navy, lineHeight: 1.02 }, palabra),
    div({ borderLeft: `8px solid ${MARCA.ambar}`, paddingLeft: 28 },
      txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 46, color: MARCA.tinta, lineHeight: 1.35 }, resto.join('\n'))),
    txt({ fontFamily: 'Inter', fontWeight: 600, fontSize: 36, color: MARCA.gris, lineHeight: 1.4 }, p.copy || ''));
}

function tarjetaItem(n, texto, destacado) {
  const partes = String(texto).split('·');
  const titulo = partes[0].trim();
  const sub = partes.slice(1).join('·').trim();
  return div({
    alignItems: 'center', gap: 24, width: '100%',
    padding: 28, borderRadius: 22,
    backgroundColor: destacado ? MARCA.azulSuave : MARCA.blanco,
    border: `2px solid ${destacado ? MARCA.azul : MARCA.linea}`,
  },
    div({ width: 64, height: 64, flexShrink: 0, borderRadius: 999, backgroundColor: MARCA.navy, alignItems: 'center', justifyContent: 'center' },
      txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 32, color: MARCA.blanco }, String(n))),
    div({ flexDirection: 'column', flexGrow: 1, gap: sub ? 6 : 0 },
      txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 38, color: destacado ? MARCA.azul : MARCA.navy, lineHeight: 1.15 }, titulo),
      sub ? txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 30, color: MARCA.gris, lineHeight: 1.25 }, sub) : null));
}

function cuerpoLista(p) {
  const items = (p.laminas || []).slice(0, 6);
  return div({ flexDirection: 'column', flexGrow: 1, gap: 34 },
    titularBloque(p.titular, 76),
    div({ flexDirection: 'column', gap: 18 }, ...items.map((it, i) => tarjetaItem(i + 1, it, i === 1))),
    p.copy ? txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 34, color: MARCA.tinta, lineHeight: 1.35 }, p.copy) : null);
}

function cuerpoComparativa(p) {
  const items = (p.laminas || []).slice(0, 5);
  return div({ flexDirection: 'column', flexGrow: 1, gap: 30 },
    titularBloque(p.titular, 76),
    div({ flexDirection: 'column', gap: 18 }, ...items.map((it) => {
      const m = String(it).split('→');
      const mal = (m[0] || '').trim().replace(/^MAL\s*[·:.\-]?\s*/i, '').trim();
      const bien = (m[1] || '').trim().replace(/^BIEN\s*[·:.\-]?\s*/i, '').trim();
      return div({ flexDirection: 'column', gap: 10, padding: 24, borderRadius: 20, backgroundColor: MARCA.blanco, border: `2px solid ${MARCA.linea}` },
        div({ alignItems: 'flex-start', gap: 14 },
          txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 30, color: '#DC2626', flexShrink: 0 }, '✗'),
          txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 32, color: MARCA.gris, lineHeight: 1.25, textDecoration: 'line-through' }, mal)),
        div({ alignItems: 'flex-start', gap: 14 },
          txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 30, color: MARCA.verde, flexShrink: 0 }, '✓'),
          txt({ fontFamily: 'Inter', fontWeight: 600, fontSize: 32, color: MARCA.navy, lineHeight: 1.25 }, bien)));
    })));
}

function cuerpoPrueba(p) {
  return div({ flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flexGrow: 1, gap: 44, textAlign: 'center' },
    div({ flexDirection: 'column', alignItems: 'center' },
      txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 130, color: MARCA.azul, lineHeight: 1, textAlign: 'center' }, p.titular || '')),
    txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 40, color: MARCA.tinta, lineHeight: 1.4, textAlign: 'center' }, p.copy || ''));
}

function cuerpoOferta(p) {
  return div({ flexDirection: 'column', justifyContent: 'center', flexGrow: 1, gap: 36 },
    div({ alignSelf: 'flex-start', paddingTop: 12, paddingBottom: 12, paddingLeft: 28, paddingRight: 28, borderRadius: 999, backgroundColor: MARCA.ambar },
      txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 30, color: MARCA.navy }, 'ASESORÍA DE TESIS')),
    titularBloque(p.titular, 96),
    txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 42, color: MARCA.tinta, lineHeight: 1.4 }, p.copy || ''));
}

const CUERPOS = {
  FRASE: cuerpoFrase, DICCIONARIO: cuerpoDiccionario, CHECKLIST: cuerpoLista,
  COMPARATIVA: cuerpoComparativa, PRUEBA: cuerpoPrueba, OFERTA: cuerpoOferta,
};

// Portada de carrusel (slide 1) y láminas internas
function slideCarrusel(p, idx, total) {
  const esPortada = idx === 0;
  const item = esPortada ? null : (p.laminas || [])[idx - 1];
  return marco(
    div({ flexDirection: 'column', flexGrow: 1, justifyContent: esPortada ? 'center' : 'flex-start', gap: 40 },
      esPortada
        ? div({ flexDirection: 'column', gap: 30 },
            titularBloque(p.titular, 100),
            txt({ fontFamily: 'Inter', fontWeight: 600, fontSize: 40, color: MARCA.gris }, 'Desliza →'))
        : div({ flexDirection: 'column', gap: 30 },
            txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 200, color: MARCA.papel2, lineHeight: 1 }, String(idx).padStart(2, '0')),
            tarjetaItem(idx, item || '', true),
            p.copy && idx === total - 1 ? txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 34, color: MARCA.tinta, lineHeight: 1.35 }, p.copy) : null)),
    p, 1350);
}

// ── Marco común (header + cuerpo + footer sobre papel) ──
function marco(cuerpo, p, alto = 1920) {
  return div({
    width: 1080, height: alto, flexDirection: 'column', backgroundColor: MARCA.papel,
    paddingTop: 70, paddingBottom: 60, paddingLeft: 70, paddingRight: 70, fontFamily: 'Inter',
  },
    header(p.tema),
    div({ width: '100%', height: 3, backgroundColor: MARCA.linea, marginTop: 30, marginBottom: 30 }),
    cuerpo,
    div({ width: '100%', height: 3, backgroundColor: MARCA.linea, marginTop: 30, marginBottom: 30 }),
    footer(p.cta));
}

async function aPng(nodo, w, alto) {
  const svg = await satori(nodo, { width: w, height: alto, fonts: FONTS });
  return sharp(Buffer.from(svg)).png({ quality: 92 }).toBuffer();
}

// Renderiza una pieza → array de Buffers PNG (1 estático, N carrusel)
export async function renderPieza(p) {
  const formato = String(p.formato || 'FRASE').toUpperCase();
  if (formato === 'CARRUSEL') {
    const n = Math.max(2, Math.min(8, (p.laminas || []).length + 1));
    const bufs = [];
    for (let i = 0; i < n; i++) bufs.push(await aPng(slideCarrusel(p, i, n), 1080, 1350));
    return bufs;
  }
  const cuerpo = (CUERPOS[formato] || cuerpoFrase)(p);
  return [await aPng(marco(cuerpo, p, 1920), 1080, 1920)];
}
