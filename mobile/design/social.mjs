// Immagini social del sito (OG 1200x630, post 1080x1080, story 1080x1920) su carta con grana.
// Uso: node design/social.mjs  -> scrive in site/assets/social/
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN, THEMES, mark, paper, render, svgDoc, textPath, textWidth, wrap } from './lib.mjs';

const OUT = join(DESIGN, '..', '..', 'site', 'assets', 'social');
mkdirSync(OUT, { recursive: true });
const t = THEMES.light;

/** Rigo a cinque linee a tutta larghezza con nota piena sul La e nota vuota di riferimento. */
function staff(x, y, w, gap) {
  let s = '';
  for (let i = 0; i < 5; i++) s += `<rect x="${x}" y="${y + i * gap}" width="${w}" height="${Math.max(2, gap / 14)}" fill="${t.ink}"/>`;
  const ry = gap * 0.5, rx = gap * 0.74;
  const note = (cx, cyStep, fill, stroke) => {
    const cy = y + 4 * gap - cyStep * (gap / 2);
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${cx} ${cy})" fill="${fill}" ${stroke ? `stroke="${t.ink}" stroke-width="${gap / 9}"` : ''}/>`;
  };
  return s + note(x + w * 0.42, 3, 'none', true) + note(x + w * 0.72, 6, t.blue, false);
}

function badge(cx, cy, size, label = 'In arrivo su App Store') {
  const w = textWidth('caslon', label, size) + size * 2.2, h = size * 2.4;
  return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h * 0.22}" fill="none" stroke="${t.ink}" stroke-width="${Math.max(2, size / 14)}"/>` +
    textPath('caslon', label, cx, cy + size * 0.33, size, t.ink, 'middle');
}

function title(cx, y, size, lines) {
  return lines.map((l, i) => textPath('fell', l, cx, y + i * size * 1.02, size, t.ink, 'middle')).join('');
}
const m = (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k / 1000})">${mark('light')}</g>`;

// OG 1200x630: titolo a sinistra, marchio a destra
function og(en = false) {
  const W = 1200, H = 630;
  const size = 132;
  const tx = en ? ['Every track', 'at your A'] : ['Ogni brano', 'al tuo La'];
  const sub = en ? 'Re-tune your recordings to your instrument, without touching the tempo.' : 'Cambia l’intonazione dei tuoi brani, senza toccare il tempo.';
  const bl = en ? 'Coming soon to the App Store' : undefined;
  const body = paper('light', W, H) +
    textPath('fell', tx[0], 80, 235, size, t.ink) +
    textPath('fell', tx[1], 80, 235 + size * 1.0, size, t.ink) +
    textPath('caslonItalic', sub, 84, 435, en ? 27 : 30, t.sepia) +
    badge(80 + (en ? 240 : 190), 528, 28, bl).replace(/x="(\d+\.?\d*)"/, 'x="$1"') +
    m(760, 70, 400);
  return svgDoc(W, H, body);
}
function square() {
  const W = 1080, H = 1080;
  const body = paper('light', W, H) +
    m(280, 70, 520) +
    title(W / 2, 760, 150, ['Ogni brano', 'al tuo La']) +
    textPath('caslonItalic', 'RePitch · intonazione per musicisti', W / 2, 960, 34, t.sepia, 'middle') +
    badge(W / 2, 1020, 30);
  return svgDoc(W, H, body);
}
function story() {
  const W = 1080, H = 1920;
  const body = paper('light', W, H) +
    textPath('fell', 'RePitch', W / 2, 270, 120, t.ink, 'middle') +
    staff(110, 520, W - 220, 62) +
    title(W / 2, 1030, 190, ['Ogni brano', 'al tuo La']) +
    wrap('caslonItalic', 'Cambia l’intonazione dei tuoi brani in tempo reale, senza toccare il tempo.', 44, 800)
      .map((l, i) => textPath('caslonItalic', l, W / 2, 1380 + i * 62, 44, t.sepia, 'middle')).join('') +
    badge(W / 2, 1640, 44);
  return svgDoc(W, H, body);
}
render(og(), join(OUT, 'og-image.png'), 1200);
render(og(true), join(OUT, 'og-image-en.png'), 1200);
render(square(), join(OUT, 'post-square.png'), 1080);
render(story(), join(OUT, 'story.png'), 1080);
console.log('ok social');
