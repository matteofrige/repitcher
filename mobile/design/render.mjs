// Genera marchio, icone (iOS/Android/splash/favicon) e loghi. Uso: node design/render.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN, IMAGES, THEMES, mark, markIn, paper, render, svgDoc, textPath, textWidth } from './lib.mjs';

const OUT = join(DESIGN, 'out');
mkdirSync(OUT, { recursive: true });
const only = process.argv[2]; // "mark" per le sole anteprime

// Marchio da solo
const markSvg = svgDoc(1000, 1000, mark('light'));
writeFileSync(join(DESIGN, 'mark.svg'), markSvg);
writeFileSync(join(DESIGN, 'mark-dark.svg'), svgDoc(1000, 1000, mark('dark')));
const prev = join(process.env.TMPDIR ?? OUT, 'mark-preview');
mkdirSync(prev, { recursive: true });

const iconSvg = (theme, k = 1.0) => svgDoc(1024, 1024, paper(theme, 1024, 1024) + markIn(theme, 1024, k, { dy: 50 }));
for (const s of [1024, 180, 60]) render(iconSvg('light'), join(prev, `icon-${s}.png`), s);
for (const s of [1024, 180, 60]) render(iconSvg('dark'), join(prev, `icon-dark-${s}.png`), s);
if (only === 'mark') { console.log('anteprime in', prev); process.exit(0); }

// --- iOS ---
render(iconSvg('light'), join(IMAGES, 'icon.png'), 1024);
render(iconSvg('dark'), join(IMAGES, 'icon-dark.png'), 1024);
const gray = { ink: '#E6E6E6', blue: '#FFFFFF', slur: '#BDBDBD', paper: '#000' };
render(svgDoc(1024, 1024, markIn('dark', 1024, 1.0, { dy: 50, colors: gray })), join(IMAGES, 'icon-tinted.png'), 1024);

// --- Android adaptive (zona sicura 66% = 676 px; il marchio ha ~86% di larghezza utile) ---
render(svgDoc(1024, 1024, markIn('light', 1024, 0.78, { dy: 30 })), join(IMAGES, 'android-icon-foreground.png'), 1024);
render(svgDoc(1024, 1024, paper('light', 1024, 1024)), join(IMAGES, 'android-icon-background.png'), 1024);
render(svgDoc(1024, 1024, markIn('light', 1024, 0.78, { dy: 30, colors: { ink: '#000', blue: '#000', slur: '#000' } })), join(IMAGES, 'android-icon-monochrome.png'), 1024);

// --- splash (trasparente; sfondo dal plugin) ---
render(svgDoc(1024, 1024, markIn('light', 1024, 1, { dy: 50 })), join(IMAGES, 'splash-icon.png'), 1024);
render(svgDoc(1024, 1024, markIn('dark', 1024, 1, { dy: 50 })), join(IMAGES, 'splash-icon-dark.png'), 1024);

// --- favicon ---
render(iconSvg('light', 0.9), join(IMAGES, 'favicon.png'), 48);

// --- loghi ---
const NAME = 'RePitch';
function horizontal(theme) {
  const t = THEMES[theme];
  const W = 1600, H = 600, mk = 560, size = 230;
  const tw = textWidth('fell', NAME, size);
  const gap = 10;
  const total = mk + gap + tw;
  const x0 = (W - total) / 2;
  const body = paper(theme, W, H, 'g') +
    `<g transform="translate(${x0} ${(H - mk) / 2}) scale(${mk / 1000})">${mark(theme)}</g>` +
    textPath('fell', NAME, x0 + mk + gap, H / 2 + size * 0.28, size, t.ink);
  return svgDoc(W, H, body);
}
function stacked(theme) {
  const t = THEMES[theme];
  const W = 1200, H = 1200;
  const body = paper(theme, W, H, 'g') +
    `<g transform="translate(${(W - 640) / 2} 90) scale(${0.64})">${mark(theme)}</g>` +
    textPath('fell', NAME, W / 2, 850, 250, t.ink, 'middle') +
    textPath('caslonItalic', 'Intonazione per musicisti', W / 2, 960, 56, t.sepia, 'middle');
  return svgDoc(W, H, body);
}
for (const [name, fn] of [['logo-horizontal', horizontal], ['logo-stacked', stacked]]) {
  for (const theme of ['light', 'dark']) {
    const base = join(OUT, name + (theme === 'dark' ? '-dark' : ''));
    const svg = fn(theme);
    writeFileSync(base + '.svg', svg);
    render(svg, base + '.png', 2400);
  }
}
console.log('ok');
