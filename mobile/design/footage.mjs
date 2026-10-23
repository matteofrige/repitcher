// Footage dei simulatori: individua l'intervallo utile di un clip grezzo (usato da video.mjs e launch.mjs).
import { execFileSync } from 'node:child_process';

export const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });

// Finds [ready, end] (s) in a raw clip: ready = first frame showing app content (paper background with
// text, i.e. not the home screen, the black launch card or the sparse splash); end = first later frame
// that is no longer paper (the home screen after terminate).
export function detect(file) {
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
