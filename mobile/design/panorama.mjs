// Panorama App Store: UNA tela 3W x H tagliata in tre tavole contigue. Uso: node panorama.mjs   (DEVICE_STORE=ipad per iPad 13")
// Genera out/appstore/panorama/{it,en}/{1,2,3}.png (+ panorama-full.png al 50%) oppure .../panorama/ipad/{it,en}/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { DESIGN, FONT_FILES, THEMES, markIn, paper, svgDoc, textPath, textWidth, wrap } from './lib.mjs';

const IPAD = process.env.DEVICE_STORE === 'ipad';
const W = IPAD ? 2064 : 1320, H = IPAD ? 2752 : 2868, K = W / 1320;
const SHOT = IPAD ? 0.5 : 0.6;
const t = THEMES.light;

function crcTable() { const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } return T; }
const CT = crcTable();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
/** PNG RGB (colour type 2) senza alpha, da pixel RGBA opachi; x0/cw ritagliano una colonna di larghezza cw. */
function pngRgb(rgba, fw, h, x0 = 0, cw = fw) {
  const row = cw * 3, raw = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (row + 1)] = 0; for (let x = 0; x < cw; x++) { const s = (y * fw + x0 + x) * 4, d = y * (row + 1) + 1 + x * 3; raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const TEXT = {
  it: [
    ['Ogni brano al tuo La', 'Imposta l’accordatura del tuo strumento: RePitch adatta tutta la musica.'],
    ['Il La di ogni brano, trovato da solo', 'RePitch ascolta il brano e ne rileva l’accordatura, offline.'],
    ['Accordatore e metronomo', 'Con i temperamenti storici, senza pubblicità né abbonamenti.'],
  ],
  en: [
    ['Every track at your A', 'Set your instrument’s tuning: RePitch adapts all your music.'],
    ['Each track’s A, found for you', 'RePitch listens to the track and detects its tuning, offline.'],
    ['Tuner and metronome', 'With historical temperaments, no ads, no subscriptions.'],
  ],
};
const SHOTS = ['intonazione', 'player', 'accordatore'];
const ROT = IPAD ? [-4, 3, -2] : [-6, 4, -3];

const balanced = (f, tx, sz, mw) => { const n = wrap(f, tx, sz, mw).length; let w = mw; while (w > 300 && wrap(f, tx, sz, w - 15).length === n) w -= 15; return wrap(f, tx, sz, w); };
const TS = (IPAD ? 80 : 96) * K, SS = (IPAD ? 38 : 42) * K, TLH = (IPAD ? 98 : 118) * K, SLH = (IPAD ? 54 : 60) * K;
function block(title, sub, cx, top) {
  const tl = balanced('fell', title, TS, (IPAD ? 1180 : 1060) * K), sl = balanced('caslon', sub, SS, (IPAD ? 1180 : 960) * K);
  let y = top, s = '';
  for (const l of tl) { s += textPath('fell', l, cx, y + 76 * K, TS, t.ink, 'middle'); y += TLH; }
  y += 14 * K;
  for (const l of sl) { s += textPath('caslon', l, cx, y + 42 * K, SS, t.sepia, 'middle'); y += SLH; }
  return { svg: s, h: y - top };
}

// --- rigo ondulato continuo ---------------------------------------------------
const SP = 34 * K;
const bez = (p0, p1, p2, p3, u) => { const m = 1 - u; return [0, 1].map((i) => m ** 3 * p0[i] + 3 * m * m * u * p1[i] + 3 * m * u * u * p2[i] + u ** 3 * p3[i]); };
function staff(base) {
  // base = y della linea centrale all'altezza della cucitura 1; stesse proporzioni su entrambi i formati
  const VS = IPAD ? 0.5 : 1, Y = (f) => base + f * K * VS;
  const s0 = [[-100 * K, Y(0)], [400 * K, Y(0)], [1000 * K, Y(20)], [1500 * K, Y(-60)]];
  // seg 2 e 3 con S (controllo riflesso)
  const refl = (c, p) => [2 * p[0] - c[0], 2 * p[1] - c[1]];
  const a1 = refl(s0[2], s0[3]), a2 = [2200 * K, Y(-640)], a3 = [2640 * K, Y(-640)];
  const b1 = refl(a2, a3), b2 = [3500 * K, Y(-1190)], b3 = [4060 * K, Y(-1240)];
  const segs = [s0, [s0[3], a1, a2, a3], [a3, b1, b2, b3]];
  const centre = (x) => { for (const sg of segs) if (x >= sg[0][0] && x <= sg[3][0]) { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (bez(...sg, m)[0] < x) lo = m; else hi = m; } return bez(...sg, lo)[1]; } return segs[2][3][1]; };
  let d = `M${s0[0][0]} ${s0[0][1]}`; for (const sg of segs) d += ` C${sg[1].join(' ')} ${sg[2].join(' ')} ${sg[3].join(' ')}`;
  let out = '';
  for (let i = -2; i <= 2; i++) out += `<path d="${d}" transform="translate(0 ${i * SP})" fill="none" stroke="${t.sepia}" stroke-width="${3 * K}" opacity=".75" stroke-linecap="round"/>`;
  return { svg: out, centre };
}
/** testa di nota piena su linea/spazio `step` (mezzi spazi dal centro, + = in basso) con gambo. */
function note(cx, cy, step, color) {
  const y = cy + step * (SP / 2), rx = 27 * K, ry = 19.5 * K, up = step >= 0;
  const sx = up ? cx + rx * 0.9 : cx - rx * 0.9, sy = up ? y - 3 * K : y + 3 * K, ey = up ? y - 120 * K : y + 120 * K;
  return `<line x1="${sx}" y1="${sy}" x2="${sx}" y2="${ey}" stroke="${color}" stroke-width="${3.4 * K}" stroke-linecap="round"/>` +
    `<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${cx} ${y})" fill="${color}"/>`;
}

for (const lang of ['it', 'en']) {
  const rawDir = join(DESIGN, 'raw', IPAD ? 'ipad' : '', lang === 'en' ? 'en' : '');
  const outDir = join(DESIGN, 'out/appstore/panorama', IPAD ? 'ipad' : '', lang);
  mkdirSync(outDir, { recursive: true });
  const imgs = SHOTS.map((n) => readFileSync(join(rawDir, `${n}.png`)));
  const iw = imgs[0].readUInt32BE(16), ih = imgs[0].readUInt32BE(20);
  
  // testi: pannelli 1-2 in alto (stessa quota), 3 in basso
  const top = (IPAD ? 110 : 150) * K;
  const b1 = block(...TEXT[lang][0], W * 0.5, top), b2 = block(...TEXT[lang][1], W * 1.5, top);
  const textBottom = top + Math.max(b1.h, b2.h);
  const b3h = block(...TEXT[lang][2], 0, 0).h, t3 = H - (IPAD ? 100 : 150) * K - b3h;
  const b3 = block(...TEXT[lang][2], W * 2.5, t3);

  // telefoni: centro (cx, cy)
  const aTop = textBottom + (IPAD ? 40 : 70) * K;
  let swf = W * SHOT;
  if (IPAD) { const rr = (d) => Math.abs(d) * Math.PI / 180, k = Math.max(...ROT.map((d) => (ih / iw) * Math.cos(rr(d)) + Math.sin(rr(d)))); swf = Math.min(W * 0.8, (H - 60 * K - aTop) / k); }
  const sw = Math.round(swf), sh = Math.round((sw * ih) / iw), R = Math.round(60 * K);
  const phones = IPAD ? [
    { cx: W + 0.15 * sw - sw / 2, cy: aTop + sh / 2 + 4 * K },
    { cx: W * 1.5, cy: aTop + sh / 2 + 4 * K },
    { cx: W * 2.5, cy: t3 - 60 * K - sh / 2 - (sw / 2) * Math.sin(2 * Math.PI / 180) },
  ] : [
    { cx: W + 0.18 * sw - sw / 2, cy: aTop + sh / 2 },
    { cx: W * 1.5 + 60 * K, cy: aTop + 150 * K + sh / 2 },
    { cx: W * 2.5, cy: t3 - 110 * K - sh / 2 },
  ];
  const lowest = (p, deg) => { const a = Math.abs(deg) * Math.PI / 180; return p.cy + (sh / 2) * Math.cos(a) + (sw / 2) * Math.sin(a); };
  const st = staff(IPAD ? H * 0.66 : lowest(phones[0], ROT[0]) + 36 * K + 2 * SP);

  let defs = `<defs><filter id="sh" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="${26 * K}"/></filter></defs>`;
  let ph = '';
  (IPAD ? [1, 2, 0] : [0, 1, 2]).forEach((i) => {
    const p = phones[i];
    const x = p.cx - sw / 2, y = p.cy - sh / 2;
    defs += `<defs><clipPath id="c${i}"><rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="${R}"/></clipPath></defs>`;
    ph += `<g transform="rotate(${ROT[i]} ${p.cx} ${p.cy})">` +
      `<rect x="${x}" y="${y + 28 * K}" width="${sw}" height="${sh}" rx="${R}" fill="${t.ink}" opacity=".18" filter="url(#sh)"/>` +
      `<image x="${x}" y="${y}" width="${sw}" height="${sh}" clip-path="url(#c${i})" href="data:image/png;base64,${imgs[i].toString('base64')}"/>` +
      `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="${R}" fill="none" stroke="${t.ink}" stroke-width="${2 * K}"/></g>`;
  });

  // note sul rigo (x, mezzo-spazio dal centro, colore)
  const nl = IPAD ? [[150, 2, t.ink], [330, -1, t.ink], [2545, 2, t.ink], [2650, 0, t.blue], [2745, -2, t.ink], [3880, -1, t.ink]] : [[200, 2, t.ink], [455, 0, t.ink], [1190, -1, t.ink], [1322, -3, t.blue], [1470, 1, t.ink], [2500, 3, t.ink], [2640, 1, t.blue], [2770, -2, t.ink], [3860, -1, t.ink]];
  let notes = '';
  for (const [x, s, c] of nl) notes += note(x * K, st.centre(x * K), s, c);

  // marchio + nome in basso al pannello 1
  const ms = (IPAD ? 72 : 96) * K, wm = (IPAD ? 46 : 56) * K, nameW = textWidth('fell', 'RePitch', wm), gap = 14 * K;
  const gx = IPAD ? 110 * K : W / 2 - (ms + gap + nameW) / 2, gy = IPAD ? H - 70 * K - ms / 2 : Math.min(H - 40 * K - ms / 2, (st.centre(W / 2) + 2 * SP + 44 * K + H) / 2);
  const brand = `<g transform="translate(${gx} ${gy - ms / 2})">${markIn('light', ms, 1.15)}</g>` + textPath('fell', 'RePitch', gx + ms + gap, gy + 18 * K, wm, t.ink);

  const svg = svgDoc(3 * W, H, paper('light', 3 * W, H, 'g') + st.svg + notes + b1.svg + b2.svg + b3.svg + defs + ph + brand);
  const opts = (fit) => ({ fitTo: fit, font: { fontFiles: Object.values(FONT_FILES), loadSystemFonts: false } });
  const r = new Resvg(svg, opts({ mode: 'original' })).render();
  for (let i = 0; i < 3; i++) writeFileSync(join(outDir, `${i + 1}.png`), pngRgb(r.pixels, r.width, r.height, i * W, W));
  const half = new Resvg(svg, opts({ mode: 'width', value: (3 * W) / 2 })).render();
  writeFileSync(join(outDir, 'panorama-full.png'), pngRgb(half.pixels, half.width, half.height));
  console.log(lang, IPAD ? 'ipad' : 'iphone', `${W}x${H}`, 'A bottom', Math.round(lowest(phones[0], ROT[0])), 'text3 top', Math.round(t3));
}
