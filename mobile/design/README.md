# Design RePitch Mobile

Strumenti: `npm install` in questa cartella, poi `node render.mjs` (marchio, icone, loghi) e `node store.mjs` (tavole App Store).
Rendering SVG→PNG con `@resvg/resvg-js`; testo convertito in path con `opentype.js` (font TTF da `node_modules/@expo-google-fonts`). Grana carta: `assets/textures/paper-grain-*.png`.

## Provenienza (tutto generato da `lib.mjs`, funzione `mark()`)
| File | Comando / sorgente |
|---|---|
| `design/mark.svg`, `mark-dark.svg` | `node design/render.mjs` — `lib.mjs#mark` |
| `assets/images/icon.png`, `icon-dark.png`, `icon-tinted.png` | `node design/render.mjs` — mark + grana (tinted: grigi su trasparente) |
| `assets/images/android-icon-{foreground,background,monochrome}.png` | `node design/render.mjs` — marchio al 78% (zona sicura 66%) |
| `assets/images/splash-icon.png`, `splash-icon-dark.png` | `node design/render.mjs` — marchio su trasparente |
| `assets/images/favicon.png` | `node design/render.mjs` — icona a 48 px |
| `design/out/logo-{horizontal,stacked}[-dark].svg/png` | `node design/render.mjs` — testo in path, PNG 2400 px |
| `design/out/appstore/0N-*.png` | `node design/store.mjs` — input `design/raw/<nome>.png` (fallback `.impeccable/review/phone-*-light.png`) |

Screenshot grezzi: `DEVICE_NAME="iPhone 16 Pro Max" bash scripts/sim-screens.sh` (copia in `design/raw/`).
