// Copertina del profilo PayPal (paypal.me/matteofrige459): 2400x936, carta con grana.
// L'avatar tondo di PayPal copre l'angolo in basso a sinistra: lì non va niente.
// Uso: node design/paypal.mjs  -> design/out/paypal/cover-{light,dark}.png
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN, THEMES, paper, render, svgDoc, textPath } from './lib.mjs';

const OUT = join(DESIGN, 'out', 'paypal');
mkdirSync(OUT, { recursive: true });
const W = 2400, H = 936;

function cover(theme) {
  const t = THEMES[theme];
  const gap = 38, top = 150, x0 = 0, x1 = W;
  // Rigo a tutta larghezza che sfuma ai bordi.
  let s = `<defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0">` +
    `<stop offset="0" stop-color="${t.ink}" stop-opacity="0"/><stop offset=".12" stop-color="${t.ink}" stop-opacity=".9"/>` +
    `<stop offset=".88" stop-color="${t.ink}" stop-opacity=".9"/><stop offset="1" stop-color="${t.ink}" stop-opacity="0"/></linearGradient></defs>`;
  for (let i = 0; i < 5; i++) s += `<rect x="${x0}" y="${top + i * gap}" width="${x1 - x0}" height="3" fill="url(#fade)"/>`;
  // Note: La di riferimento vuoto, glissando, nota blu più in alto (il marchio, disteso sul rigo).
  const rx = gap * 0.74, ry = gap * 0.52;
  const yOf = (step) => top + 4 * gap - step * (gap / 2);
  const a = { x: 860, y: yOf(3) }, b = { x: 1540, y: yOf(7) };
  const k = 1.15 * rx;
  s += `<line x1="${a.x + k}" y1="${a.y - 6}" x2="${b.x - k}" y2="${b.y + 6}" stroke="${t.ink}" stroke-width="5" stroke-linecap="round"/>`;
  s += `<ellipse cx="${a.x}" cy="${a.y}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${a.x} ${a.y})" fill="none" stroke="${t.ink}" stroke-width="7"/>`;
  s += `<ellipse cx="${b.x}" cy="${b.y}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${b.x} ${b.y})" fill="${t.blue}"/>`;
  // Titolo e sottotitolo, centrati a destra dell'avatar.
  const cx = 1340;
  s += textPath('fell', 'Ogni brano al tuo La', cx, 560, 128, t.ink, 'middle');
  s += textPath('caslonItalic', 'RePitch · l’app gratuita che accorda i brani al tuo strumento', cx, 668, 40, t.sepia, 'middle');
  return svgDoc(W, H, paper(theme, W, H) + s);
}

for (const theme of ['light', 'dark']) render(cover(theme), join(OUT, `cover-${theme}.png`), W);
console.log('ok paypal');
