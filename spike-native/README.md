# spike-native — harness di validazione audiotee

Valida tre proprietà di `audiotee`:
1. Cattura l'audio di sistema (RMS sale con Spotify/YouTube).
2. `excludeProcesses` impedisce di ri-catturare il tono prodotto da questa stessa app (no Larsen).
3. `mute` silenzia l'uscita originale.

## Comandi di lancio

> Usa i percorsi assoluti: `electron` risolve il main script rispetto alla cwd corrente.

**Modalità principale — esclusione ON + mute ON:**
```bash
EXCLUDE=1 MUTE=1 /Users/matteofrige/Projects/repitch/node_modules/.bin/electron /Users/matteofrige/Projects/repitch/spike-native/main.js
```

**Modalità controllo — senza esclusione (recapture attesa):**
```bash
EXCLUDE=0 MUTE=1 /Users/matteofrige/Projects/repitch/node_modules/.bin/electron /Users/matteofrige/Projects/repitch/spike-native/main.js
```

Variabili d'ambiente opzionali: `SR` (sample rate, default 48000), `CHUNK_MS` (durata chunk ms, default 20).

## Protocollo

1. Seleziona device di output. Premi **"1) Suona tono 440 Hz"** — devi sentirlo.
2. Premi **"2) Avvia cattura nativa"** (il tono deve essere già acceso).
3. Osserva "RMS catturato":
   - **EXCLUDE=1**, solo tono → RMS ~0 = esclusione funziona (no Larsen). VERDE.
   - **EXCLUDE=1**, solo tono → RMS ≥ 0.02 = esclusione fallita. ROSSO.
   - **EXCLUDE=0** → RMS alto = recapture atteso (controllo). GIALLO.
4. Avvia Spotify/YouTube → RMS deve salire (tap cattura il sistema).
   Con MUTE=1 non devi sentire Spotify dagli altoparlanti; il tono resta udibile (escluso dal tap).
