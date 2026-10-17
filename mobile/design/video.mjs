// App Preview videos from the simulator clips (scripts/sim-video.sh -> design/raw/video/<iphone|ipad>[/en]/raw-<scene>.mp4).
// Output in design/out/video/: appstore-iphone-{it,en}.mp4 (886x1920), appstore-ipad-{it,en}.mp4 (1200x1600),
// youtube-{it,en}.mp4 (1920x1080), instagram-{feed,reel}-{it,en}.mp4 (1080x1350, 1080x1920). Needs ffmpeg/ffprobe. Usage: node design/video.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { DESIGN, FONT_FILES, THEMES, paper, svgDoc, textPath, wrap } from './lib.mjs';

const t = THEMES.light;
const OUT = join(DESIGN, 'out/video');
const TMP = process.env.VIDEO_TMP || join(DESIGN, 'out/video/.tmp');
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

// Scene order and texts (same as the store slides: design/store.mjs). len = seconds shown; skip the launch.
const SCENES = [
  { id: 'tuning', len: 6.4, it: ['Ogni brano al tuo La', 'Imposta l’accordatura del tuo strumento: RePitch adatta tutta la musica.'], en: ['Every track at your A', 'Set your instrument’s tuning: RePitch adapts all your music.'] },
  { id: 'library', len: 4.5, it: ['Il La di ogni brano, trovato da solo', 'RePitch ascolta il brano e ne rileva l’accordatura, offline.'], en: ['Each track’s A, found for you', 'RePitch listens to the track and detects its tuning, offline.'] },
  { id: 'player', len: 6, it: ['Trasporta solo il brano che vuoi', 'Semitoni e cents per singolo brano, salvati per sempre.'], en: ['Transpose just the track you want', 'Semitones and cents per track, saved for good.'] },
  { id: 'metronome', len: 5.5, it: ['Metronomo e accordatore', 'Precisi al campione, sempre a portata di mano.'], en: ['Metronome and tuner', 'Sample-accurate, always at hand.'] },
];
const FADE = 0.3, FPS = 30, LEAD = 0.5;

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
const ff = (args) => sh('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
const font = { fontFiles: Object.values(FONT_FILES), loadSystemFonts: false };
const png = (svg, file) => writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'original' }, font }).render().asPng());
const balanced = (f, tx, sz, mw) => { const n = wrap(f, tx, sz, mw).length; let w = mw; while (w > 200 && wrap(f, tx, sz, w - 12).length === n) w -= 12; return wrap(f, tx, sz, w); };

// Finds [ready, end] (s) in a raw clip: ready = first frame showing app content (paper background with
// text, i.e. not the home screen, the black launch card or the sparse splash); end = first later frame
// that is no longer paper (the home screen after terminate).
function detect(file) {
  const w = 240, h = 320, px = w * h;
  const buf = sh('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', `fps=10,scale=${w}:${h},format=rgb24`, '-f', 'rawvideo', '-']);
  const n = Math.floor(buf.length / (px * 3));
  let ready = -1, end = n / 10;
  for (let i = 0; i < n; i++) {
    let paperPx = 0, dark = 0;
    for (let k = 0; k < px; k++) {
      const o = (i * px + k) * 3, r = buf[o], g = buf[o + 1], b = buf[o + 2];
      if (r > 215 && r < 252 && g > 205 && g < 245 && b > 165 && b < 220 && r - b > 20) paperPx++;
      else if (r + g + b < 450) dark++;
    }
    const pf = paperPx / px, ink = dark / px;
    if (ready < 0) { if (pf > 0.7 && ink > 0.008) ready = i / 10; }
    else if (pf < 0.2) { end = i / 10; break; }
  }
  if (ready < 0) throw new Error(`no app content found in ${file}`);
  return { ready, end };
}

// Background (paper + title + shadow), rounded mask and frame stroke for a canvas/footage geometry.
function layers(key, W, H, g, texts) {
  const { x, y, w, h, r } = g;
  let body = paper('light', W, H, 'g');
  if (texts) body += texts;
  if (g.shadow) body += `<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${g.shadow}"/></filter></defs><rect x="${x}" y="${y + g.shadow}" width="${w}" height="${h}" rx="${r}" fill="${t.ink}" opacity=".16" filter="url(#sh)"/>`;
  png(svgDoc(W, H, body), join(TMP, `${key}-bg.png`));
  png(svgDoc(w, h, `<rect width="${w}" height="${h}" fill="#000"/><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/>`), join(TMP, `${key}-mask.png`));
  png(svgDoc(W, H, `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="${r}" fill="none" stroke="${t.ink}" stroke-width="2"/>`), join(TMP, `${key}-frame.png`));
}

// One scene clip: footage trimmed from the raw clip, scaled, rounded, over its own background.
function sceneClip(out, key, raw, W, H, g, len) {
  const { ready, end } = detect(raw);
  // fps first: the clips are variable-rate and a still screen has no frames to trim at.
  const start = ready + LEAD;
  const avail = Math.max(0.5, end - start);
  const pad = Math.max(0, len - avail);
  const vf = `[0:v]fps=${FPS},trim=start=${start},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},trim=duration=${len},scale=${g.w}:${g.h}:flags=lanczos,format=rgba[v];` +
    `[2:v]format=gray[m];[v][m]alphamerge[vr];[1:v][vr]overlay=${g.x}:${g.y}[o];[o][3:v]overlay=0:0,format=yuv420p[out]`;
  ff(['-i', raw, '-loop', '1', '-framerate', String(FPS), '-i', join(TMP, `${key}-bg.png`), '-loop', '1', '-framerate', String(FPS), '-i', join(TMP, `${key}-mask.png`),
    '-loop', '1', '-framerate', String(FPS), '-i', join(TMP, `${key}-frame.png`), '-filter_complex', vf, '-map', '[out]', '-t', String(len), '-r', String(FPS),
    '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-pix_fmt', 'yuv420p', out]);
  return { ready, end };
}

// Background music (Pixabay licence: "The Mountain - Royal Baroque"); without it the track is silent.
const MUSIC = join(DESIGN, 'audio/the-mountain-royal-baroque.mp3');
const MUSIC_START = 0, MUSIC_FADE_OUT = 1.5;

// Crossfade the clips and add a stereo AAC track: the music (faded, loudness-normalised) or silence.
function join_(clips, durs, out, W, H) {
  const args = clips.flatMap((c) => ['-i', c]);
  let chain = '', prev = '[0:v]', acc = durs[0];
  for (let i = 1; i < clips.length; i++) {
    const off = (acc - FADE).toFixed(3);
    chain += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${off}[x${i}];`;
    prev = `[x${i}]`; acc += durs[i] - FADE;
  }
  chain += `${prev}fps=${FPS},format=yuv420p[v]`;
  const music = existsSync(MUSIC);
  const ain = music ? ['-ss', String(MUSIC_START), '-i', MUSIC] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  if (music) chain += `;[${clips.length}:a]atrim=0:${acc.toFixed(3)},afade=t=in:d=0.2,afade=t=out:st=${(acc - MUSIC_FADE_OUT).toFixed(3)}:d=${MUSIC_FADE_OUT},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[a]`;
  ff([...args, ...ain, '-filter_complex', chain, '-map', '[v]', '-map', music ? '[a]' : `${clips.length}:a`, '-t', acc.toFixed(3),
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-r', String(FPS), '-fps_mode', 'cfr', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out]);
  return acc;
}

const rawDir = (kind, lang) => join(DESIGN, 'raw/video', kind, lang === 'en' ? 'en' : '');
const dims = (f) => sh('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);

// Portrait App Store layouts: title band on top (18%), footage fitted below it, centred.
function portrait(kind, lang, W, H, K) {
  const raws = SCENES.map((s) => join(rawDir(kind, lang), `raw-${s.id}.mp4`));
  if (!raws.every(existsSync)) { console.warn(`! ${kind} ${lang}: missing raw clips, skipped`); return; }
  const [rw, rh] = dims(raws[0]);
  const band = Math.round(H * 0.18), margin = Math.round(28 * K);
  const h = H - band - margin, w = Math.round((h * rw) / rh) & ~1;
  const g = { x: Math.round((W - w) / 2), y: band, w, h: h & ~1, r: Math.round(54 * K), shadow: Math.round(18 * K) };
  const clips = [], durs = [];
  SCENES.forEach((s, i) => {
    const [title] = s[lang];
    const size = 72 * K, tl = balanced('fell', title, size, W - 140 * K);
    const lh = size * 1.08, y0 = (band - tl.length * lh) / 2 + size * 0.78;
    const text = tl.map((l, j) => textPath('fell', l, W / 2, y0 + j * lh, size, t.ink, 'middle')).join('');
    const key = `${kind}-${lang}-${s.id}`;
    layers(key, W, H, g, text);
    const out = join(TMP, `${key}.mp4`);
    const d = sceneClip(out, key, raws[i], W, H, g, s.len);
    console.log(`  ${key} ready=${d.ready}s end=${d.end}s`);
    clips.push(out); durs.push(s.len);
  });
  const file = join(OUT, `appstore-${kind}-${lang}.mp4`);
  console.log(file, join_(clips, durs, file, W, H).toFixed(2) + 's');
}

// Landscape 1920x1080: iPhone footage left, title and subtitle right.
function youtube(lang) {
  const kind = 'iphone', W = 1920, H = 1080;
  const raws = SCENES.map((s) => join(rawDir(kind, lang), `raw-${s.id}.mp4`));
  if (!raws.every(existsSync)) { console.warn(`! youtube ${lang}: missing raw clips, skipped`); return; }
  const [rw, rh] = dims(raws[0]);
  const h = 1000, w = Math.round((h * rw) / rh) & ~1;
  const g = { x: Math.round((W / 2 - w) / 2), y: 40, w, h, r: 50, shadow: 18 };
  const tx = 1000, tw = 820;
  const clips = [], durs = [];
  SCENES.forEach((s, i) => {
    const [title, sub] = s[lang];
    const tl = balanced('fell', title, 96, tw), sl = balanced('caslon', sub, 42, tw);
    const total = tl.length * 106 + 30 + sl.length * 62;
    let y = (H - total) / 2 + 76, text = '';
    for (const l of tl) { text += textPath('fell', l, tx, y, 96, t.ink); y += 106; }
    y += 30 - 20;
    for (const l of sl) { text += textPath('caslon', l, tx, y + 42, 42, t.sepia); y += 62; }
    const key = `youtube-${lang}-${s.id}`;
    layers(key, W, H, g, text);
    const out = join(TMP, `${key}.mp4`);
    sceneClip(out, key, raws[i], W, H, g, s.len);
    clips.push(out); durs.push(s.len);
  });
  const file = join(OUT, `youtube-${lang}.mp4`);
  console.log(file, join_(clips, durs, file, W, H).toFixed(2) + 's');
}

// Instagram, YouTube texts on top and iPhone footage below. feed = 1080x1350 (4:5), reel = 1080x1920 (9:16);
// the reel keeps text and footage out of the areas covered by Instagram's UI (top ~220px, bottom ~300px).
function instagram(lang, fmt) {
  const kind = 'iphone', W = 1080, H = fmt === 'reel' ? 1920 : 1350;
  const top = fmt === 'reel' ? 230 : 50, band = fmt === 'reel' ? 330 : 300, bottom = fmt === 'reel' ? 290 : 40;
  const raws = SCENES.map((s) => join(rawDir(kind, lang), `raw-${s.id}.mp4`));
  if (!raws.every(existsSync)) { console.warn(`! instagram ${lang}: missing raw clips, skipped`); return; }
  const [rw, rh] = dims(raws[0]);
  const y = top + band, h = (H - y - bottom) & ~1, w = Math.round((h * rw) / rh) & ~1;
  const g = { x: Math.round((W - w) / 2), y, w, h, r: Math.round(50 * h / 1000), shadow: 16 };
  const tw = W - 140, clips = [], durs = [];
  SCENES.forEach((s, i) => {
    const [title, sub] = s[lang];
    const tl = balanced('fell', title, 68, tw), sl = balanced('caslon', sub, 34, tw - 60);
    const total = tl.length * 76 + 18 + sl.length * 46;
    let ty = top + (band - total) / 2 + 54, text = '';
    for (const l of tl) { text += textPath('fell', l, W / 2, ty, 68, t.ink, 'middle'); ty += 76; }
    ty += 18 - 54 + 34;
    for (const l of sl) { text += textPath('caslon', l, W / 2, ty, 34, t.sepia, 'middle'); ty += 46; }
    const key = `instagram-${fmt}-${lang}-${s.id}`;
    layers(key, W, H, g, text);
    const out = join(TMP, `${key}.mp4`);
    sceneClip(out, key, raws[i], W, H, g, s.len);
    clips.push(out); durs.push(s.len);
  });
  const file = join(OUT, `instagram-${fmt}-${lang}.mp4`);
  console.log(file, join_(clips, durs, file, W, H).toFixed(2) + 's');
}

// node design/video.mjs [appstore|youtube|instagram ...]: all by default.
const only = process.argv.slice(2), want = (k) => !only.length || only.includes(k);
for (const lang of ['it', 'en']) {
  if (want('appstore')) {
    portrait('iphone', lang, 886, 1920, 886 / 1320);
    portrait('ipad', lang, 1200, 1600, 1200 / 1320);
  }
  if (want('youtube')) youtube(lang);
  if (want('instagram')) { instagram(lang, 'feed'); instagram(lang, 'reel'); }
}
