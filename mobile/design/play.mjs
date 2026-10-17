// Grafica per Google Play: icona 512x512 (PNG senza trasparenza: Play applica la sua maschera)
// e feature graphic 1024x500, in italiano e inglese.
// Uso: node design/play.mjs  -> design/out/play/
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN, THEMES, markIn, paper, render, svgDoc, textPath, textWidth } from './lib.mjs';

const OUT = join(DESIGN, 'out', 'play');
mkdirSync(OUT, { recursive: true });
const t = THEMES.light;

// Icona: stessa composizione dell'icona iOS (marchio su carta con grana).
render(svgDoc(1024, 1024, paper('light', 1024, 1024) + markIn('light', 1024, 1.0, { dy: 50 })), join(OUT, 'icon-512.png'), 512);

// Feature graphic: marchio a sinistra, titolo e sottotitolo a destra. Google può sovrapporre
// il pulsante play al centro nei video: qui non c'è video, ma teniamo i bordi liberi (~8%).
function feature(title, sub) {
  const W = 1024, H = 500;
  const mk = 400;
  let size = 76;
  while (textWidth('fell', title, size) > 530 && size > 50) size -= 2;
  let subSize = 26;
  while (textWidth('caslonItalic', sub, subSize) > 530 && subSize > 18) subSize -= 1;
  const x = 410;
  const body = paper('light', W, H) +
    `<g transform="translate(10 ${(H - mk) / 2 + 45})">${markIn('light', mk, 1.0, { dy: 50 }).replace(/^<g transform="translate\(([\d.]+) ([\d.]+)\)/, '<g transform="translate($1 $2)')}</g>` +
    textPath('fell', 'RePitch', x, 205, 40, t.sepia) +
    textPath('fell', title, x, 295, size, t.ink) +
    textPath('caslonItalic', sub, x, 352, subSize, t.sepia);
  return svgDoc(W, H, body);
}
render(feature('Ogni brano al tuo La', 'Accorda i tuoi brani al tuo strumento, in tempo reale.'), join(OUT, 'feature-it.png'), 1024);
render(feature('Every track at your A', 'Re-tune your recordings to your instrument, in real time.'), join(OUT, 'feature-en.png'), 1024);
console.log('ok play');
