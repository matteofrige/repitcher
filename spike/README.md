# Spike — Loopback Auto-Cattura Test

Harness minimale per verificare se `electron-audio-loopback` ri-cattura
l'audio prodotto dalla stessa app (auto-cattura → rischio eco Larsen).

---

## Come lanciare (dalla root del progetto)

```bash
# 1. ScreenCaptureKit + mute ON  ← PROVA QUESTO PER PRIMO
MUTE=1 FORCE_CATAP=0 npx electron spike/main.js

# 2. Core Audio Tap + mute ON
MUTE=1 FORCE_CATAP=1 npx electron spike/main.js

# 3. ScreenCaptureKit + mute OFF  (confronto: senti l'audio originale)
MUTE=0 FORCE_CATAP=0 npx electron spike/main.js

# 4. Core Audio Tap + mute OFF
MUTE=0 FORCE_CATAP=1 npx electron spike/main.js
```

---

## Protocollo di test rapido

1. Aggiorna la lista device e seleziona il tuo output (cuffie o altoparlanti).
2. Clicca **"1) Avvia cattura loopback"** — attendi che il bottone diventi attivo.
3. Con nessun audio in riproduzione e tono OFF, verifica che **RMS catturato ≈ 0**.
4. Clicca **"2) Suona tono 440 Hz sull'uscita"**.
5. Osserva il **BANNER VERDETTO**:

| Banner | Significato |
|--------|-------------|
| **VERDE** "Nessuna auto-cattura" | L'uscita dell'app NON rientra nel tap → backend sicuro per RePitch |
| **ROSSO** "AUTO-CATTURA RILEVATA" | Il loopback re-ingerisce il proprio output → rischio Larsen |

6. Spegni il tono e avvia Spotify/YouTube: RMS deve salire (tap funziona).
   Con `MUTE=1` non devi sentire nulla dagli altoparlanti (mute funziona).

---

## Interpretazione risultati attesi

- **ScreenCaptureKit (CATAP=0)**: su macOS 14+ dovrebbe isolare solo le app
  "campionate" e tipicamente NON re-ingerisce il proprio output → verde.
- **Core Audio Tap (CATAP=1)**: cattura tutto l'audio di sistema; potrebbe
  includere l'output della stessa app → possibile rosso, da verificare.
- Il **verdetto verde con tono ON** è la condizione necessaria per usare
  quel backend in produzione senza rischio di feedback loop.
