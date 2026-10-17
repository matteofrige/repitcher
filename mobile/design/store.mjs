// Tavole App Store 6,9" (1320x2868). Input: design/raw/<nome>.png (script del simulatore) oppure
// i fallback in .impeccable/review. Uso: node design/store.mjs   (LANG_STORE=en -> raw/en, out/appstore/en)
// DEVICE_STORE=android|android-tablet -> tavole Google Play da raw/android/<phone|tablet>[/en], in out/play/<phone|tablet>[/en].
// DEVICE_STORE=ipad -> tavole iPad 13" (2064x2752) da raw/ipad[/en], in out/appstore/ipad[/en].
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { DESIGN, FONT_FILES, ROOT, THEMES, paper, svgDoc, textPath, wrap } from './lib.mjs';

const MODE = process.env.DEVICE_STORE;
const IPAD = MODE === 'ipad', AND = MODE === 'android', ATAB = MODE === 'android-tablet';
// Play: phone 1080x1920 (9:16), tablet 1600x2560 (portrait captures, same layout as the iPad mode); no alpha, sides 320-3840.
const W = ATAB ? 1600 : AND ? 1080 : IPAD ? 2064 : 1320, H = ATAB ? 2560 : AND ? 1920 : IPAD ? 2752 : 2868;
// Testo e cornice in scala con la larghezza; sull'iPad lo schermo è più largo che alto in proporzione.
const K = W / 1320, SHOT = ATAB ? 0.7 : IPAD ? 0.7 : 0.76;
const EN = process.env.LANG_STORE === 'en';
const KIND = ATAB ? 'tablet' : 'phone';
const SUB = join(IPAD ? 'ipad' : '', AND || ATAB ? join('android', KIND) : '', EN ? 'en' : '');
const REVIEW = join(ROOT, '.impeccable/review', SUB);
const OUT = AND || ATAB ? join(DESIGN, 'out/play', KIND, EN ? 'en' : '') : join(DESIGN, 'out/appstore', SUB);
mkdirSync(OUT, { recursive: true });
const SLIDES_IT = [
  ['01-intonazione', 'intonazione', 'phone-intonazione-tab-light.png', 'Ogni brano al tuo La', "Imposta l’accordatura del tuo strumento: RePitch adatta tutta la musica."],
  ['02-libreria', 'libreria', 'phone-libreria-light.png', 'Il La di ogni brano, trovato da solo', 'RePitch ascolta il brano e ne rileva l’accordatura, offline.'],
  ['03-player', 'player', 'phone-player-light.png', 'Trasporta solo il brano che vuoi', 'Semitoni e cents per singolo brano, salvati per sempre.'],
  ['04-playlist', 'playlist', 'phone-playlist-dettaglio-light.png', 'Playlist per lezioni e prove', 'Prepara la scaletta una volta, suona ogni volta.'],
  ['05-metronomo', 'metronomo', 'phone-metronomo-light.png', 'Metronomo e accordatore', 'Precisi al campione, sempre a portata di mano.'],
];
const EN_TEXT = [
  ['Every track at your A', 'Set your instrument’s tuning: RePitch adapts all your music.'],
  ['Each track’s A, found for you', 'RePitch listens to the track and detects its tuning, offline.'],
  ['Transpose just the track you want', 'Semitones and cents per track, saved for good.'],
  ['Playlists for lessons and rehearsals', 'Build the setlist once, play it every time.'],
  ['Metronome and tuner', 'Sample-accurate, always at hand.'],
];
const SLIDES = EN ? SLIDES_IT.map((s, i) => [s[0], s[1], s[2], ...EN_TEXT[i]]) : SLIDES_IT;
const t = THEMES.light;

function crcTable() { const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } return T; }
const CT = crcTable();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
/** PNG RGB (colour type 2) senza canale alpha, da pixel RGBA opachi. */
function pngRgb(rgba, w, h) {
  const row = w * 3, raw = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (row + 1)] = 0; for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = y * (row + 1) + 1 + x * 3; raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const [out, name, fallback, title, sub] of SLIDES) {
  let src = join(DESIGN, 'raw', SUB, `${name}.png`);
  if (!existsSync(src)) {
    const pre = AND || ATAB ? `android-${KIND}-` : IPAD ? 'ipad-' : 'phone-';
    src = join(REVIEW, fallback.replace(/^phone-/, pre));
    if (!existsSync(src)) src = join(REVIEW, `${pre}libreria-miniplayer-light.png`);
    console.warn(`! raw/${name}.png mancante: uso ${src.replace(ROOT + '/', '')}`);
  }
  const png = readFileSync(src);
  const iw = png.readUInt32BE(16), ih = png.readUInt32BE(20);
  const R = Math.round((ATAB ? 36 : 60) * K);
  // righe bilanciate: restringe la colonna finché il numero di righe non cambia (niente vedove)
  const balanced = (f, tx, sz, mw) => { const n = wrap(f, tx, sz, mw).length; let w = mw; while (w > 300 && wrap(f, tx, sz, w - 15).length === n) w -= 15; return wrap(f, tx, sz, w); };
  const tl = balanced('fell', title, 104 * K, 1120 * K), sl = balanced('caslon', sub, 44 * K, 1000 * K);
  let y = 190 * K, text = '';
  for (const l of tl) { text += textPath('fell', l, W / 2, y + 80 * K, 104 * K, t.ink, 'middle'); y += 124 * K; }
  y += 14 * K;
  for (const l of sl) { text += textPath('caslon', l, W / 2, y + 44 * K, 44 * K, t.sepia, 'middle'); y += 64 * K; }
  let sy = y + 100 * K;
  // Width share of the canvas, shrunk if needed so the device frame ends above the bottom edge.
  const sw = Math.round(Math.min(W * SHOT, ((H - sy - 110 * K) * iw) / ih)), sh = Math.round((sw * ih) / iw), sx = (W - sw) / 2;
  const frame = `<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${26 * K}"/></filter><clipPath id="c"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${R}"/></clipPath></defs>` +
    `<rect x="${sx}" y="${sy + 28 * K}" width="${sw}" height="${sh}" rx="${R}" fill="${t.ink}" opacity=".16" filter="url(#sh)"/>` +
    `<image x="${sx}" y="${sy}" width="${sw}" height="${sh}" clip-path="url(#c)" href="data:image/png;base64,${png.toString('base64')}"/>` +
    `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${R}" fill="none" stroke="${t.ink}" stroke-width="${2 * K}"/>`;
  const svg = svgDoc(W, H, paper('light', W, H, 'g') + text + frame);
  const r = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontFiles: Object.values(FONT_FILES), loadSystemFonts: false } }).render();
  writeFileSync(join(OUT, `${out}.png`), pngRgb(r.pixels, r.width, r.height));
  console.log(out, `${r.width}x${r.height}`, 'bottom', sy + sh);
}
