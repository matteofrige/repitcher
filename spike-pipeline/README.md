# spike-pipeline — Harness pipeline PCM real-time

Valida la pipeline: `audiotee` (stereo) → IPC → ring buffer → AudioWorklet → uscita audio stereo.
Passthrough stereo float32, nessuno shift di pitch. Scopo: verificare assenza di glitch e misurare latenza.

## Avvio

```bash
BIN=$HOME/Desktop/audiotee-build/.build/release/audiotee CHUNK_MS=10 MUTE=1 EXCLUDE=1 \
  /Users/matteofrige/Projects/repitch/node_modules/.bin/electron \
  /Users/matteofrige/Projects/repitch/spike-pipeline/main.js
```

| Variabile  | Descrizione                                          | Default    |
|------------|------------------------------------------------------|------------|
| `BIN`      | Path del binario audiotee stereo (OBBLIGATORIO)      | —          |
| `CHUNK_MS` | Durata chunk PCM in ms                               | 10         |
| `MUTE`     | `1` = muta l'uscita originale (senti solo il tap)    | 1          |
| `EXCLUDE`  | `1` = esclude i PID Audio Service da audiotee        | 1          |

Il binario viene lanciato con `--stereo` (float32 LE, 48000 Hz, 2 canali interleaved).
Il wrapper npm `audiotee` non supporta `--stereo`, quindi il binario viene spawnato direttamente.

## Cosa osservare

- **Audio pulito**: dovresti sentire Spotify/YouTube riprodotto attraverso la pipeline, senza il segnale originale (MUTE=1).
- **Underrun stabile**: il contatore non deve salire di continuo — se cresce → glitch → banner rosso.
- **Buffer ms = latenza**: il riempimento corrente del ring buffer è il proxy della latenza end-to-end; 50–100 ms è accettabile.
- **Overflow = 0** (o quasi): campioni scartati per ring pieno — se alto, riduci `CHUNK_MS`.
