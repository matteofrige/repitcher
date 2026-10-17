// Asset leggeri per il sito: loghi senza grana (sfondo trasparente), marchio, favicon.
// Uso: node design/web.mjs  -> scrive in site/assets/
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN, THEMES, mark, markIn, paper, render, svgDoc, textPath, textWidth } from './lib.mjs';

const OUT = join(DESIGN, '..', '..', 'site', 'assets');
mkdirSync(OUT, { recursive: true });

const NAME = 'RePitch';
function horizontal(theme) {
  const t = THEMES[theme];
  const mk = 560, size = 230, gap = 10;
  const tw = textWidth('fell', NAME, size);
  const W = Math.ceil(mk + gap + tw), H = mk;
  const body =
    `<g>${mark(theme)}</g>`.replace('<g>', `<g transform="scale(${mk / 1000})">`) +
    textPath('fell', NAME, mk + gap, H / 2 + size * 0.28, size, t.ink);
  return svgDoc(W, H, body);
}
for (const theme of ['light', 'dark']) {
  const sfx = theme === 'dark' ? '-dark' : '';
  writeFileSync(join(OUT, `logo${sfx}.svg`), horizontal(theme));
  writeFileSync(join(OUT, `mark${sfx}.svg`), svgDoc(1000, 1000, mark(theme)));
}
// Favicon e icona touch: marchio su carta con grana (come l'icona dell'app)
const icon = (theme, k = 1) => svgDoc(1024, 1024, paper(theme, 1024, 1024) + markIn(theme, 1024, k, { dy: 50 }));
render(icon('light', 0.9), join(OUT, 'favicon-48.png'), 48);
render(icon('light', 0.9), join(OUT, 'favicon-192.png'), 192);
render(icon('light'), join(OUT, 'apple-touch-icon.png'), 180);
console.log('ok web');
