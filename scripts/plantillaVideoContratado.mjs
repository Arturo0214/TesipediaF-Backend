// Plantilla 9:16 (1080x1920) de fondo para VIDEOS de Contratado: fondo oscuro con
// el logo + wordmark arriba y el handle/URL abajo (equivalente a la de Tesipedia).
// Render con satori + sharp (sin fuentes del sistema). Salida en ~/Desktop/Claude-Code/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import satori from 'satori';
import sharp from 'sharp';

const DIR = dirname(fileURLToPath(import.meta.url));
const font = (f) => readFileSync(resolve(DIR, '../assets/fonts', f));
const FONTS = [
  { name: 'Inter', data: font('Inter-Regular.ttf'), weight: 400, style: 'normal' },
  { name: 'Inter', data: font('Inter-SemiBold.ttf'), weight: 600, style: 'normal' },
  { name: 'Inter', data: font('Inter-ExtraBold.ttf'), weight: 800, style: 'normal' },
];
const logoB64 = readFileSync('/tmp/redes-brand/contratado-logo.png').toString('base64');
const LOGO = `data:image/png;base64,${logoB64}`;

const h = (type, style, ...c) => ({ type, props: { style: { display: 'flex', ...style }, children: c.length === 1 ? c[0] : c } });
const txt = (style, s) => h('div', style, String(s));
const img = (style, src) => ({ type: 'img', props: { style, src } }); // sin display:flex ni children

const W = 1080, H = 1920;
const nodo = h('div', {
  width: W, height: H, flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
  paddingTop: 120, paddingBottom: 90, fontFamily: 'Inter',
  // Fondo oscuro con leve tinte navy de marca
  backgroundColor: '#05070d',
  backgroundImage: 'linear-gradient(180deg, #0e1a30 0%, #080e1c 55%, #05070d 100%)',
},
  // Logo + wordmark arriba
  h('div', { alignItems: 'center', gap: 26 },
    img({ width: 108, height: 108, borderRadius: 26, backgroundColor: '#fff', padding: 8 }, LOGO),
    txt({ fontFamily: 'Inter', fontWeight: 800, fontSize: 62, letterSpacing: 8, color: '#FFFFFF' }, 'CONTRATADO'),
  ),
  // (centro vacío para el contenido del video)
  h('div', { flexGrow: 1 }, ' '),
  // Footer: handle + URL
  h('div', { alignItems: 'center', gap: 16 },
    img({ width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff', padding: 4 }, LOGO),
    txt({ fontFamily: 'Inter', fontWeight: 600, fontSize: 34, color: '#12C27A' }, '@contratadomx'),
    txt({ fontFamily: 'Inter', fontWeight: 400, fontSize: 34, color: '#9aa7bd' }, '· contratado.com.mx'),
  ),
);

const svg = await satori(nodo, { width: W, height: H, fonts: FONTS });
const out = resolve(os.homedir(), 'Desktop', 'Claude-Code', 'contratado-plantilla');
mkdirSync(out, { recursive: true });
const file = resolve(out, 'contratado-video-9x16-negro.png');
await sharp(Buffer.from(svg)).png().toFile(file);
console.log('✅', file);
