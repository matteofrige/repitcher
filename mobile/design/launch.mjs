// Video di lancio 9:16 (Reel/Story/TikTok), in italiano: gancio sul rigo, risoluzione, 4 scene di footage, finale col marchio.
// Output: design/out/video/lancio-reel-it.mp4 (1080x1920, 30 fps). Tagli a tempo di battuta (analisi beat del brano).
// Usage: [MUSIC=file] [MUSIC_START=s] node design/launch.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { DESIGN, FONT_FILES, THEMES, paper, svgDoc, textPath, textWidth, wrap } from './lib.mjs';
import { detect, sh } from './footage.mjs';

const t = THEMES.light;
const OUT = join(DESIGN, 'out/video');
const TMP = join(OUT, '.tmp-launch');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const W = 1080, H = 1920, FPS = 30, LEAD = 0.5, HOLD = 1;
const ff = (args) => sh('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
const font = { fontFiles: Object.values(FONT_FILES), loadSystemFonts: false };
const png = (svg, file) => writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'original' }, font }).render().asPng());
const balanced = (f, tx, sz, mw) => { const n = wrap(f, tx, sz, mw).length; let w = mw; while (w > 200 && wrap(f, tx, sz, w - 12).length === n) w -= 12; return wrap(f, tx, sz, w); };

// Musica (Pixabay licence: "Baroque Trap" by alanajordan, pixabay.com/music/beats-baroque-trap-412613; fallback "The Mountain - Royal Baroque").
const MUSIC = process.env.MUSIC || [join(DESIGN, 'audio/baroque-trap.mp3'), join(DESIGN, 'audio/the-mountain-royal-baroque.mp3')].find(existsSync);

// ---- analisi beat -------------------------------------------------------------------------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
function analyse(file) {
  const SR = 22050, N = 1024, HOP = 512, fps = SR / HOP;
  const raw = sh('ffmpeg', ['-loglevel', 'error', '-t', '60', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  const x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 4)));
  const nf = Math.floor((x.length - N) / HOP);
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const flux = new Float64Array(nf), rms = new Float64Array(nf);
  let prev = new Float64Array(N / 2);
  for (let f = 0; f < nf; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) { const s = x[f * HOP + i]; re[i] = s * win[i]; e += s * s; }
    fft(re, im);
    let fl = 0;
    const cur = new Float64Array(N / 2);
    for (let k = 1; k < N / 2; k++) { cur[k] = Math.log1p(20 * Math.hypot(re[k], im[k])); const d = cur[k] - prev[k]; if (d > 0) fl += d; }
    flux[f] = fl; rms[f] = Math.sqrt(e / N); prev = cur;
  }
  // envelope: subtract a ~1 s moving average, half-wave rectify
  const env = new Float64Array(nf), m = Math.round(fps / 2);
  for (let i = 0; i < nf; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - m); j < Math.min(nf, i + m); j++) { s += flux[j]; c++; } env[i] = Math.max(0, flux[i] - s / c); }
  const at = (p) => { if (p < 0 || p >= nf - 1) return 0; const i = Math.floor(p), r = p - i; return env[i] * (1 - r) + env[i + 1] * r; };
  const ac = (lag) => { let s = 0; for (let i = 0; i < nf - 1 - lag; i++) s += env[i] * at(i + lag); return s / (nf - lag); };
  let best = 0, bpm = 100;
  for (let b = 70; b <= 160; b += 0.1) {
    const L = (60 / b) * fps, sc = ac(L) + 0.5 * ac(2 * L) + 0.25 * ac(4 * L);
    if (sc > best) { best = sc; bpm = b; }
  }
  // il trap "pensa" in tempo doppio: tagli sul battito veloce (120-160), le scene si allungano in battiti
  while (bpm < 120) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  const comb = (b, ph) => { const P = (60 / b) * fps; let s = 0, c = 0; for (let p = ph; p < nf - 1; p += P) { s += at(p); c++; } return s / c; };
  // refine tempo and beat phase together
  let top = -1, phase = 0, bb = bpm;
  for (let b = bpm - 2; b <= bpm + 2; b += 0.05) {
    const P = (60 / b) * fps;
    for (let ph = 0; ph < P; ph += 0.25) { const s = comb(b, ph); if (s > top) { top = s; phase = ph; bb = b; } }
  }
  bpm = bb;
  const period = 60 / bpm, t0 = (phase * HOP + N / 2) / SR; // first beat (s), frame centre
  const first = t0 % period;
  let start = null;
  if (process.env.MUSIC_START) start = +process.env.MUSIC_START;
  else {
    const win20 = Math.floor(20 * fps), cand = [];
    for (let s = first; s <= 20; s += period) {
      const a = Math.round((s * SR) / HOP); let e = 0;
      for (let j = a; j < Math.min(nf, a + win20); j++) e += rms[j];
      cand.push([s, e / win20]);
    }
    const mx = Math.max(...cand.map((c) => c[1]));
    start = cand.find((c) => c[1] >= 0.9 * mx)[0]; // earliest beat followed by loud material
  }
  return { bpm, period, start, first };
}
const { bpm: BPM, period: b, start: MSTART } = analyse(MUSIC);
console.log(`music ${MUSIC}\nBPM ${BPM.toFixed(2)}  beat ${b.toFixed(4)} s  start ${MSTART.toFixed(3)} s`);

// ---- timeline (beats) ---------------------------------------------------------------------------
const BEATS = [10, 8, 6, 6, 6, 6, 14];
const bounds = [0]; BEATS.forEach((n, i) => bounds.push(bounds[i] + n * b));
bounds[7] += HOLD;
const F = bounds.map((s) => Math.round(s * FPS)), TOTAL = F[7] / FPS;
const R0 = BEATS[0] * b; // start of Resolution

const ez = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - 2 ** (-10 * x));
const seg = (u, t0, d) => ez((u - t0) / d);
const lin = (x) => Math.min(1, Math.max(0, x));
const n2 = (v) => +v.toFixed(2);
const fadeRise = (u, t0, d, rise, inner) => { const p = seg(u, t0, d); return p <= 0 ? '' : `<g opacity="${n2(p)}" transform="translate(0 ${n2(rise * (1 - p))})">${inner}</g>`; };

// ---- sfondo -------------------------------------------------------------------------------------
const BG = join(TMP, 'bg.png');
png(svgDoc(W, H, paper('light', W, H, 'g')), BG);

// ---- rigo: gancio + risoluzione ---------------------------------------------------------------
const GAP = 46, Y3 = 1000, LY = [0, 1, 2, 3, 4].map((i) => Y3 - 2 * GAP + i * GAP); // dall'alto in basso
const A4y = (LY[3] + LY[2]) / 2, // La: secondo spazio dal basso
   B4y = LY[2], G4y = LY[3];
const RX = 32, RY = 23, NS = 4.5;
const T = { fell: 'fell', fi: 'fellItalic' };
const hookLines = balanced('fell', 'La registrazione è a 440.', 92, 920);
const hookTitle = hookLines.map((l, i) => textPath('fell', l, W / 2, 480 + i * 100, 92, t.ink, 'middle')).join('');
const l2y = 480 + hookLines.length * 100 - 5;
const hookSub = textPath('fellItalic', 'Il tuo ensemble, a 415.', W / 2, l2y, 64, t.sepia, 'middle');
const resLines = balanced('fell', 'RePitch li mette d’accordo.', 92, 920);
const resTitle = resLines.map((l, i) => textPath('fell', l, W / 2, 480 + i * 100, 92, t.ink, 'middle')).join('');
// Noto Music: corpo = 4 spazi, linea di base sul rigo più basso (come il sito)
const clef = textPath('music', '\u{1D11E}', 110, LY[4], 4 * GAP, t.ink);
const lab = (tx, x, c) => textPath('caslonItalic', tx, x, LY[4] + 76, 36, c, 'middle');
const noteEl = (cx, cy, o) => `<ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" transform="rotate(-20 ${cx} ${cy})" ${o}/>`;
const NX = { a: 470, p: 660, n: 730 };
// slur: segment between the two heads with a gap, as in mark()
const gl = (() => {
  const dx = NX.n - NX.a, dy = B4y - A4y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const phi = Math.atan2(uy, ux) + (20 * Math.PI) / 180, e = 1 / Math.sqrt(Math.cos(phi) ** 2 / RX ** 2 + Math.sin(phi) ** 2 / RY ** 2) + NS / 2 + 9;
  return [NX.a + ux * e, A4y + uy * e, NX.n - ux * e, B4y - uy * e];
})();

function hookFrame(u) {
  let s = '';
  LY.forEach((y, i) => { const p = seg(u, i * 0.06, 0.45); if (p > 0) s += `<line x1="90" y1="${y}" x2="990" y2="${y}" stroke="${t.ink}" stroke-width="2.8" stroke-dasharray="900" stroke-dashoffset="${n2(900 * (1 - p))}" opacity=".92"/>`; });
  s += `<g opacity="${n2(seg(u, 0.3, 0.5))}">${clef}</g>`;
  const wp = seg(u, 0.5 * b, 0.9), xo = 1 - lin((u - R0) / 0.25);
  if (wp > 0 && xo > 0) s += `<clipPath id="wipe"><rect x="60" y="360" width="${n2(960 * wp)}" height="260"/></clipPath><g opacity="${n2(xo)}" clip-path="url(#wipe)">${hookTitle}</g>`;
  if (xo > 0) s += `<g opacity="${n2(xo)}">${fadeRise(u, 4 * b, 0.4, 20, hookSub)}</g>`;
  s += fadeRise(u, R0, 0.25, 0, '') + (u >= R0 ? `<g opacity="${n2(lin((u - R0) / 0.25))}">${resTitle}</g>` : '');
  // 440 (empty) note
  const pa = seg(u, 2 * b, 0.3);
  if (pa > 0) s += `<g opacity="${n2(pa)}" transform="translate(0 ${n2(-8 * (1 - pa))})">${noteEl(NX.a, A4y, `fill="none" stroke="${t.ink}" stroke-width="${NS}"`)}</g><g opacity="${n2(pa)}">${lab('La 440', NX.a, t.sepia)}</g>`;
  // 415 pencil note, fades away in the resolution
  const pp = seg(u, 4 * b, 0.3), po = 1 - lin((u - R0) / 0.4);
  if (pp > 0 && po > 0) s += `<g opacity="${n2(pp * po)}"><g transform="translate(0 ${n2(-8 * (1 - pp))})">${noteEl(NX.p, G4y, `fill="none" stroke="${t.pencil}" stroke-width="${NS}" stroke-dasharray="7 6"`)}</g>${lab('415', NX.p, t.pencil)}</g>`;
  // resolution: slur, blue note, ring, label
  const land = R0 + 2 * b, sp = seg(u, R0 + 0.4 * b, Math.max(0.3, 1.6 * b - 0.2));
  if (sp > 0) s += `<line x1="${n2(gl[0])}" y1="${n2(gl[1])}" x2="${n2(gl[0] + (gl[2] - gl[0]) * sp)}" y2="${n2(gl[1] + (gl[3] - gl[1]) * sp)}" stroke="${t.pencil}" stroke-width="2.5" stroke-linecap="round"/>`;
  const bp = seg(u, land - 0.5, 0.5);
  if (bp > 0) s += `<g opacity="${n2(Math.min(1, bp * 3))}">${noteEl(NX.n, n2(A4y + (B4y - A4y) * bp), `fill="${t.blue}"`)}</g>`;
  const rp = (u - land) / 0.5;
  if (rp > 0 && rp < 1) { const k = 1 + 1.2 * ez(rp); s += noteEl(NX.n, B4y, `fill="none" stroke="${t.blue}" stroke-width="3" opacity="${n2(0.35 * (1 - rp))}" ` ).replace(`rx="${RX}" ry="${RY}"`, `rx="${n2(RX * k)}" ry="${n2(RY * k)}"`); }
  s += `<g opacity="${n2(seg(u, land + 0.1, 0.4))}">${lab('il tuo La', NX.n, t.blue)}</g>`;
  return s;
}

// ---- finale: marchio animato -------------------------------------------------------------------
const MS = 82, MB = 500 + 2 * MS, mY = (n) => MB - n * (MS / 2), MRX = 62, MRY = 44, MREF = { x: 350, step: 3 }, MNOTE = { x: 665, step: 6 };
const MEXT = [[170, 872], [96, 914], [64, 940], [128, 896], [186, 846]];
function markAnim(u) {
  let defs = '', body = '';
  MEXT.forEach(([x0, x1], i) => {
    const y = 500 - 2 * MS + i * MS, p = seg(u, i * 0.08, 0.5);
    if (p <= 0) return;
    defs += `<linearGradient id="f${i}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0"><stop offset="0" stop-color="${t.ink}" stop-opacity="0"/><stop offset=".14" stop-color="${t.ink}"/><stop offset=".86" stop-color="${t.ink}"/><stop offset="1" stop-color="${t.ink}" stop-opacity="0"/></linearGradient><clipPath id="c${i}"><rect x="${x0 - 5}" y="${y - 20}" width="${n2((x1 - x0 + 10) * p)}" height="40"/></clipPath>`;
    const m = (x0 + x1) / 2;
    body += `<path clip-path="url(#c${i})" d="M${x0} ${y - 3.5} Q${m} ${y - 14} ${x1} ${y - 3.5} L${x1} ${y + 3.5} Q${m} ${y + 14} ${x0} ${y + 3.5}Z" fill="url(#f${i})"/>`;
  });
  const ry = mY(MREF.step), ny = mY(MNOTE.step);
  const dx = MNOTE.x - MREF.x, dy = ny - ry, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const phi = Math.atan2(uy, ux) + (20 * Math.PI) / 180, e = 1 / Math.sqrt(Math.cos(phi) ** 2 / MRX ** 2 + Math.sin(phi) ** 2 / MRY ** 2) + 19 / 2 + 0.3 * MS;
  const g0 = [MREF.x + ux * e, ry + uy * e], g1 = [MNOTE.x - ux * e, ny - uy * e];
  const ep = seg(u, 0.55, 0.3);
  if (ep > 0) { const k = 0.7 + 0.3 * ep; body += `<g opacity="${n2(ep)}" transform="translate(${MREF.x} ${ry}) scale(${n2(k)}) translate(${-MREF.x} ${-ry})"><ellipse cx="${MREF.x}" cy="${ry}" rx="${MRX}" ry="${MRY}" transform="rotate(-20 ${MREF.x} ${ry})" fill="none" stroke="${t.ink}" stroke-width="19"/></g>`; }
  const sp = seg(u, 0.85, 0.5);
  if (sp > 0) body += `<line x1="${n2(g0[0])}" y1="${n2(g0[1])}" x2="${n2(g0[0] + (g1[0] - g0[0]) * sp)}" y2="${n2(g0[1] + (g1[1] - g0[1]) * sp)}" stroke="${t.ink}" stroke-width="8.4" stroke-linecap="round"/>`;
  const bp = seg(u, 1.3, 0.5);
  if (bp > 0) { const cy = ry + (ny - ry) * bp; body += `<g opacity="${n2(Math.min(1, bp * 3))}"><ellipse cx="${MNOTE.x}" cy="${n2(cy)}" rx="${MRX}" ry="${MRY}" transform="rotate(-20 ${MNOTE.x} ${n2(cy)})" fill="${t.blue}"/></g>`; }
  return `<defs>${defs}</defs><g transform="translate(240 400) scale(.6)">${body}</g>`;
}
const wordmark = textPath('fell', 'RePitch', W / 2, 1125, 150, t.ink, 'middle');
const store = textPath('fell', 'Ora su App Store', W / 2, 1260, 84, t.ink, 'middle');
const CTA = 'Scarica gratis per iPhone e iPad', PW = Math.round(textWidth('caslon', CTA, 40) + 120), PX = (W - PW) / 2;
const pillTxt = textPath('caslon', CTA, W / 2, 1400, 40, t.paper, 'middle');
const url = textPath('caslonItalic', 're-pitch.it · senza account', W / 2, 1520, 34, t.sepia, 'middle');
function finaleFrame(u) {
  let s = markAnim(u);
  s += fadeRise(u, 4 * b, 0.4, 24, wordmark) + fadeRise(u, 6 * b, 0.4, 24, store);
  const p = seg(u, 7 * b, 0.35);
  if (p > 0) { const k = 0.96 + 0.04 * p; s += `<g opacity="${n2(p)}" transform="translate(540 1386) scale(${n2(k)}) translate(-540 -1386)"><rect x="${PX}" y="1340" width="${PW}" height="92" rx="22" fill="${t.blue}"/>${pillTxt}</g>`; }
  return s + fadeRise(u, 8 * b, 0.4, 24, url);
}

// Renders an animated section to PNG frames (identical consecutive frames are copied) and overlays it on the paper.
function animated(name, f0, f1, fn) {
  const dir = join(TMP, name); mkdirSync(dir);
  let prev = null, prevFile = null;
  for (let i = 0; i < f1 - f0; i++) {
    const svg = svgDoc(W, H, fn(i / FPS)), file = join(dir, `${String(i).padStart(4, '0')}.png`);
    if (svg === prev) copyFileSync(prevFile, file); else png(svg, file);
    prev = svg; prevFile = file;
  }
  const out = join(TMP, `${name}.mp4`);
  enc(['-loop', '1', '-framerate', String(FPS), '-i', BG, '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-filter_complex', '[0:v][1:v]overlay=shortest=1,format=yuv420p[o]', '-map', '[o]', '-frames:v', String(f1 - f0)], out);
  rmSync(dir, { recursive: true });
  return out;
}
const enc = (args, out) => ff([...args, '-r', String(FPS), '-c:v', 'libx264', '-crf', '8', '-preset', 'fast', '-pix_fmt', 'yuv420p', out]);

// ---- footage ----------------------------------------------------------------------------------
const SCENES = [['tuning', 'Imposta il tuo La'], ['library', 'Il La di ogni brano, trovato da solo'], ['player', 'Semitoni e cents, brano per brano'], ['metronome', 'Un metronomo che segue il brano']];
const PH = 1060, PWd = Math.round((PH * 1320) / 2868) & ~1, R = 50, PAD = 60, LW = PWd + 2 * PAD, LH = PH + 2 * PAD, CY = 1090;
png(svgDoc(PWd, PH, `<rect width="${PWd}" height="${PH}" fill="#000"/><rect width="${PWd}" height="${PH}" rx="${R}" fill="#fff"/>`), join(TMP, 'mask.png'));
png(svgDoc(LW, LH, `<defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="18"/></filter></defs><rect x="${PAD}" y="${PAD + 18}" width="${PWd}" height="${PH}" rx="${R}" fill="${t.ink}" opacity=".16" filter="url(#sh)"/>`), join(TMP, 'shadow.png'));
png(svgDoc(LW, LH, `<rect x="${PAD + 1}" y="${PAD + 1}" width="${PWd - 2}" height="${PH - 2}" rx="${R}" fill="none" stroke="${t.ink}" stroke-width="2"/>`), join(TMP, 'frame.png'));
function footage(i, f0, f1) {
  const [id, title] = SCENES[i], raw = join(DESIGN, `raw/video/iphone/raw-${id}.mp4`), nf = f1 - f0, len = nf / FPS;
  const lines = balanced('fell', title, 76, 900), lh = 84, y0 = 250 + (270 - lines.length * lh) / 2 + 76 * 0.78;
  const tf = join(TMP, `title-${id}.png`);
  png(svgDoc(W, H, lines.map((l, j) => textPath('fell', l, W / 2, y0 + j * lh, 76, t.ink, 'middle')).join('')), tf);
  const { ready, end } = detect(raw), start = ready + LEAD, pad = Math.max(0, len - Math.max(0.5, end - start)) + 0.5;
  const loop = (f) => ['-loop', '1', '-framerate', String(FPS), '-i', f];
  const k = '(1+0.035*pow(2,-10*min(n/18,1)))';
  const fc = `[0:v]fps=${FPS},trim=start=${start},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},scale=${PWd}:${PH}:flags=lanczos,format=rgba[v];` +
    `[3:v]format=gray[m];[v][m]alphamerge[vr];[2:v]format=rgba[sh];[sh][vr]overlay=${PAD}:${PAD}[a];[a][4:v]overlay=0:0,` +
    `scale=w='trunc(${LW}*${k})':h='trunc(${LH}*${k})':eval=frame:flags=bilinear[ph];` +
    `[1:v][ph]overlay=x='(main_w-overlay_w)/2':y='${CY}-overlay_h/2':eval=frame,format=yuv420p[o];` +
    `[5:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1[ti];[o][ti]overlay=0:'24*pow(2,-10*min(t/0.35,1))',format=yuv420p[out]`;
  const out = join(TMP, `scene-${id}.mp4`);
  enc(['-i', raw, ...loop(BG), ...loop(join(TMP, 'shadow.png')), ...loop(join(TMP, 'mask.png')), ...loop(join(TMP, 'frame.png')), ...loop(tf), '-filter_complex', fc, '-map', '[out]', '-frames:v', String(nf)], out);
  console.log(`  ${id} ready=${ready}s end=${end}s`);
  return out;
}

// ---- assemble ---------------------------------------------------------------------------------
const parts = [animated('hookres', F[0], F[2], (u) => hookFrame(u)), ...SCENES.map((_, i) => footage(i, F[2 + i], F[3 + i])), animated('finale', F[6], F[7], (u) => finaleFrame(u))];
const list = join(TMP, 'list.txt');
writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
const master = join(TMP, 'master.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', master]);
const file = join(OUT, 'lancio-reel-it.mp4');
ff(['-i', master, '-i', MUSIC, '-filter_complex', `[1:a]atrim=start=${MSTART.toFixed(4)}:duration=${TOTAL.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=0.15,afade=t=out:st=${(TOTAL - 1.8).toFixed(3)}:d=1.8,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[a]`,
  '-map', '0:v', '-map', '[a]', '-t', TOTAL.toFixed(4), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', file]);
console.log(file, TOTAL.toFixed(2) + 's');
