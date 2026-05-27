'use strict';
/**
 * probe-format.js — sonda il formato nativo di audiotee SENZA --sample-rate.
 *
 * Ipotesi: senza --sample-rate il binario usa "Auto format" = formato nativo
 * del device, probabilmente STEREO float32. Questo script lancia il binario
 * grezzo (no wrapper), stampa i messaggi 'metadata' su stderr (che descrivono
 * sampleRate / canali / formato) e misura i byte/sec di stdout per dedurre
 * canali e bit-depth.
 *
 * Uso (con Spotify/YouTube in riproduzione, così c'è audio da catturare):
 *   ! node /Users/matteofrige/Projects/repitch/spike-pipeline/probe-format.js
 *
 * Riferimento byte/sec a 48 kHz:
 *   stereo float32 = 48000*2*4 = 384000   | mono float32 = 192000
 *   stereo int16   = 48000*2*2 = 192000   | mono int16   = 96000
 */

const { spawn } = require('child_process');
const path = require('path');

// BIN: path del binario (default = quello mono di node_modules).
// STEREO=1: aggiunge --stereo (solo il binario buildato da sorgente lo supporta).
const bin = process.env.BIN || path.join(__dirname, '..', 'node_modules', 'audiotee', 'bin', 'audiotee');
const args = process.env.STEREO === '1' ? ['--stereo'] : [];

console.log('[probe] avvio audiotee in Auto format (nessun --sample-rate). Assicurati che Spotify/YouTube stia suonando.');
console.log('[probe] binario:', bin, '| args:', args.join(' ') || '(nessuno)');

const p = spawn(bin, args); // auto format, tutti i processi

let bytes = 0;
const t0 = Date.now();

p.stdout.on('data', (d) => { bytes += d.length; });

// stderr porta i messaggi JSON strutturati, incluso 'metadata' col formato
p.stderr.on('data', (d) => {
  const lines = d.toString('utf8').split('\n').filter((l) => l.trim());
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.message_type === 'metadata') {
        console.log('[probe][METADATA]', JSON.stringify(msg.data, null, 2));
      } else if (msg.message_type === 'error') {
        console.log('[probe][ERRORE]', msg.data && msg.data.message);
      }
    } catch (_) {
      console.log('[probe][stderr non-JSON]', line);
    }
  }
});

p.on('error', (err) => console.log('[probe] errore spawn:', err.message));

setTimeout(() => {
  const secs = (Date.now() - t0) / 1000;
  const bps = Math.round(bytes / secs);
  console.log(`\n[probe] byte/sec di stdout ~ ${bps}`);
  console.log('[probe] confronto @48kHz: stereo-f32=384000  mono-f32=192000  stereo-i16=192000  mono-i16=96000');
  p.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
}, 4000);
