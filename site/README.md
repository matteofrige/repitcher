# Sito di RePitch

Landing page statica (HTML, CSS e moduli ES, nessuna dipendenza, nessuna build). Font serviti dal sito stesso, nessun cookie, nessuna chiamata a servizi esterni.

## Cosa cambiare prima di pubblicare

**`config.js`** è l'unico punto di configurazione:

| Costante | Cosa mettere |
|---|---|
| `DONATION_URL` | link PayPal: `https://www.paypal.com/paypalme/TUO-UTENTE` (paypal.me) oppure `https://www.paypal.com/donate/?hosted_button_id=ID` (pulsante ospitato) |
| `CONTACT_EMAIL` | l'indirizzo mostrato nel footer e in `privacy.html` |

Al caricamento, `main.js` imposta l'`href` di tutti gli elementi `[data-donate]` (i due bottoni "Sostieni il progetto" e "Dona con PayPal") e di `[data-contact]` (footer, privacy).

**Fallback HTML.** Gli stessi elementi hanno già in HTML `href="https://paypal.me/matteofrige459"` e `mailto:info@re-pitch.it`. Servono se il JavaScript non parte: con JS attivo vince sempre `config.js`. Quando pubblichi, cerca `INSERISCI` in tutta la cartella (`grep -rn INSERISCI .`) e sostituisci anche i fallback.

**`index.html` e `en/index.html`, meta social.** `og:url`, `og:image` e `twitter:image` usano `https://re-pitch.it/…`: i crawler dei social vogliono URL assoluti. Dominio: `re-pitch.it`.

## Versione inglese (`/en/`)

`en/index.html` e `en/privacy.html` sono le traduzioni inglesi (stessa struttura, stessi id/ancore). Condividono con le pagine italiane `../styles.css`, `../main.js`, `../config.js` e `../assets/`: donazione ed email si cambiano una volta sola in `config.js`. Le etichette del bottone "Ascolta/Ferma" sono lette da `main.js` dagli attributi `data-label-play` / `data-label-stop` del bottone, quindi ogni lingua le definisce nel proprio HTML.

- Screenshot inglesi: `assets/en-{intonazione-tab,libreria,player}-{light,dark}.webp`, da `mobile/.impeccable/review/en/` con `cwebp -q 80 -resize 1000 0`.
- Immagine social inglese: `assets/social/og-image-en.png`, generata da `node social.mjs`.
- Selettore di lingua: link "English" / "Italiano" nella testata (nascosto sotto i 560 px) e nel piede. Nessun redirect automatico in base alla lingua del browser.
- `hreflang` (it, en, x-default → inglese) e `og:`/`twitter:` puntano a `https://re-pitch.it` in tutte e quattro le pagine.

## Provarlo in locale

I moduli ES non partono da `file://` in Chrome: la pagina si vede, ma suono e link di donazione da `config.js` no. Per provarla davvero:

```
cd site
python3 -m http.server 8000
# poi apri http://localhost:8000
```

## Pubblicarlo

Ospitato su **GitHub Pages**, nel repo pubblico `matteofrige/repitch-site` (branch `main`, radice), con dominio `re-pitch.it` (file `CNAME`). `bash site/publish.sh` copia i file pubblici (esclusi questo README, `publish.sh`, `review/`, `.claude/`) e fa push: Pages si aggiorna in circa un minuto. `.nojekyll` evita l'elaborazione Jekyll.

## Rigenerare gli asset

Dalla cartella `mobile/design/` (serve `npm install` una volta):

- `node web.mjs`: logo leggero senza grana (`assets/logo*.svg`), marchio e favicon.
- `node social.mjs`: `assets/social/og-image.png` e `og-image-en.png` (1200×630). Le pagine usano le versioni JPEG `og-image.jpg` / `og-image-en.jpg` (sotto 300 KB, limite pratico di WhatsApp): rigenerale dai PNG con PIL o `sips -s format jpeg -s formatOptions 86`, `post-square.png` (1080×1080), `story.png` (1080×1920).

Gli screenshot (`assets/*-light.webp`, `*-dark.webp`) derivano da `mobile/.impeccable/review/phone-{intonazione-tab,libreria,player}-{light,dark}.png`, ridotti a 1000 px con `cwebp -q 80 -resize 1000 0`. Font: sottoinsiemi TTF di IM Fell English, Libre Caslon Text e Noto Music (`pyftsubset`, latino più la chiave di violino U+1D11E).

## Cose da sapere

- Il badge "In arrivo su App Store" è un'etichetta, non un link. Quando l'app sarà pubblicata, sostituiscilo con il badge ufficiale Apple, scaricato dalle risorse di marketing di Apple e usato secondo le loro linee guida.
- L'annotazione a matita "La del brano 441 Hz · rilevato" è testo HTML accanto allo screenshot della Libreria: lo screenshot reale non mostra ancora quella riga.
