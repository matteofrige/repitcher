// Strumenti condivisi: font, marchio, grana carta, testo -> path.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';

export const DESIGN = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(DESIGN, '..');
export const IMAGES = join(ROOT, 'assets/images');
const gf = (p) => join(ROOT, 'node_modules/@expo-google-fonts', p);

export const FONT_FILES = {
  fell: gf('im-fell-english/400Regular/IMFellEnglish_400Regular.ttf'),
  fellItalic: gf('im-fell-english/400Regular_Italic/IMFellEnglish_400Regular_Italic.ttf'),
  caslon: gf('libre-caslon-text/400Regular/LibreCaslonText_400Regular.ttf'),
  caslonItalic: gf('libre-caslon-text/400Regular_Italic/LibreCaslonText_400Regular_Italic.ttf'),
  music: gf('noto-music/400Regular/NotoMusic_400Regular.ttf'),
};
const fontCache = {};
export const font = (k) => (fontCache[k] ??= opentype.parse(readFileSync(FONT_FILES[k]).buffer.slice(0)));

// Palette (src/theme/colors.ts)
export const THEMES = {
  light: { paper: '#F1E6C8', ink: '#2A2016', sepia: '#6B5A44', blue: '#2C4A7C', pencil: '#5E5A54', grain: 'paper-grain-light.png' },
  dark: { paper: '#1B1510', ink: '#EBDDBA', sepia: '#B5A584', blue: '#9DB4DD', pencil: '#A39C90', grain: 'paper-grain-dark.png' },
};

const grainUri = (t) => 'data:image/png;base64,' + readFileSync(join(ROOT, 'assets/textures', THEMES[t].grain)).toString('base64');
/** <defs> con il pattern della grana (tile 512 px) e rettangolo che riempie [w x h]. */
export function paper(theme, w, h, id = 'grain', scale = 1) {
  return `<defs><pattern id="${id}" width="${512 * scale}" height="${512 * scale}" patternUnits="userSpaceOnUse"><image width="${512 * scale}" height="${512 * scale}" href="${grainUri(theme)}"/></pattern></defs><rect width="${w}" height="${h}" fill="${THEMES[theme].paper}"/><rect width="${w}" height="${h}" fill="url(#${id})"/>`;
}

// --- testo -> path -----------------------------------------------------------
export function textWidth(fontKey, text, size) {
  return font(fontKey).getAdvanceWidth(text, size, { kerning: true });
}
/** Path del testo; anchor: start|middle|end. */
export function textPath(fontKey, text, x, y, size, fill, anchor = 'start') {
  const w = textWidth(fontKey, text, size);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const d = font(fontKey).getPath(text, x0, y, size, { kerning: true }).toPathData(2);
  return `<path d="${d}" fill="${fill}"/>`;
}
/** Spezza il testo in righe che stanno in maxW. */
export function wrap(fontKey, text, size, maxW) {
  const lines = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const t = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(fontKey, t, size) > maxW) { lines.push(cur); cur = word; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// --- marchio -----------------------------------------------------------------
// Coordinate in un riquadro 1000x1000, centro (500,500).
// Rigo: 5 linee incise con passo S; due teste di nota ovali a -20° (come TuningStaff).
const S = 82;
const BOTTOM = 500 + 2 * S;
const stepY = (n) => BOTTOM - n * (S / 2);
const RX = 62, RY = 44;
const REF = { x: 350, step: 3 };
const NOTE = { x: 665, step: 6 };
// ogni linea del rigo si interrompe a lunghezze diverse (dall'alto in basso)
const EXTENTS = [[170, 872], [96, 914], [64, 940], [128, 896], [186, 846]];

export function mark(theme = 'light', o = {}) {
  const c = { ...THEMES[theme], ...o.colors };
  const line = c.line ?? c.ink;
  const mono = o.mono; // colore unico (alpha) per l'icona monocromatica
  const fadeStops = (id, x0, x1) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0"><stop offset="0" stop-color="${line}" stop-opacity="0"/><stop offset=".14" stop-color="${line}" stop-opacity="1"/><stop offset=".86" stop-color="${line}" stop-opacity="1"/><stop offset="1" stop-color="${line}" stop-opacity="0"/></linearGradient>`;
  let defs = '', lines = '';
  EXTENTS.forEach(([x0, x1], i) => {
    const y = 500 - 2 * S + i * S;
    const id = `fade${i}${o.uid ?? ''}`;
    defs += fadeStops(id, x0, x1);
    // linea leggermente rastremata: più spessa al centro, sottile ai capi
    const t = 14, e = 7, m = (x0 + x1) / 2;
    lines += `<path d="M${x0} ${y - e / 2} Q${m} ${y - t} ${x1} ${y - e / 2} L${x1} ${y + e / 2} Q${m} ${y + t} ${x0} ${y + e / 2}Z" fill="url(#${id})"/>`;
  });
  const ry = stepY(REF.step), ny = stepY(NOTE.step);
  // Glissando: retta da fuori la nota vuota a prima della nota piena (distacco 0,3 spazi), tratto uniforme.
  const dx = NOTE.x - REF.x, dy = ny - ry, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const phi = Math.atan2(uy, ux) + (20 * Math.PI) / 180; // direzione nel sistema dell'ellisse (ruotata di -20°)
  const edge = 1 / Math.sqrt(Math.cos(phi) ** 2 / RX ** 2 + Math.sin(phi) ** 2 / RY ** 2) + (o.noteStroke ?? 19) / 2 + 0.3 * S;
  const g0 = [REF.x + ux * edge, ry + uy * edge], g1 = [NOTE.x - ux * edge, ny - uy * edge];
  const slur = `<line x1="${g0[0]}" y1="${g0[1]}" x2="${g1[0]}" y2="${g1[1]}" stroke="${c.slur ?? c.ink}" stroke-width="${0.6 * 14}" stroke-linecap="round"/>`;
  const rot = (cx, cy) => `rotate(-20 ${cx} ${cy})`;
  const empty = `<ellipse cx="${REF.x}" cy="${ry}" rx="${RX}" ry="${RY}" transform="${rot(REF.x, ry)}" fill="${c.paperFill ?? 'none'}" stroke="${c.ink}" stroke-width="${o.noteStroke ?? 19}"/>`;
  const full = `<ellipse cx="${NOTE.x}" cy="${ny}" rx="${RX}" ry="${RY}" transform="${rot(NOTE.x, ny)}" fill="${c.blue}"/>`;
  return `<defs>${defs}</defs><g${mono ? ` opacity="1"` : ''}>${lines}${slur}${empty}${full}</g>`;
}

/** Disegna il marchio centrato in una tela [size] con scala [k]. */
export function markIn(theme, size, k, o) {
  const s = (size / 1000) * k;
  const off = (size - 1000 * s) / 2;
  return `<g transform="translate(${off} ${off + (o?.dy ?? 0) * s}) scale(${s})">${mark(theme, o)}</g>`;
}

export const svgDoc = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

export function render(svg, outPng, width) {
  const r = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { fontFiles: Object.values(FONT_FILES), loadSystemFonts: false },
  });
  writeFileSync(outPng, r.render().asPng());
}
