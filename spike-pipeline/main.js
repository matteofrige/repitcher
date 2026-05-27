'use strict';
/**
 * main.js — processo principale Electron per lo spike pipeline PCM.
 *
 * Flusso:
 *   1. Crea la finestra e carica index.html (con sr/chunk/mute nella query).
 *   2. Il renderer costruisce il grafo AudioWorklet e poi chiama 'playback-ready'.
 *   3. In 'playback-ready' spawniamo il binario audiotee in modalità stereo,
 *      escludendo i PID dell'Audio Service di Chromium per evitare cattura
 *      della nostra stessa uscita.
 *   4. I chunk PCM float32 LE stereo interleaved arrivano su stdout e vengono
 *      inoltrati al renderer via IPC.
 *
 * Variabili d'ambiente:
 *   BIN         — path del binario audiotee (OBBLIGATORIO)
 *   CHUNK_MS    — durata chunk in ms (default 10)
 *   MUTE        — muta l'uscita originale: '1'=true (default '1')
 *   EXCLUDE     — escludi l'Audio Service di Chromium: '1'=true (default '1')
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

// Abilita SharedArrayBuffer senza cross-origin isolation (serve per il ring
// buffer condiviso col worklet). Va impostato PRIMA che l'app sia pronta.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

// --- Leggi configurazione da env ---
const BIN      = process.env.BIN      || '';
const CHUNK_MS = parseInt(process.env.CHUNK_MS || '10', 10);
const MUTE     = (process.env.MUTE    ?? '1') !== '0';
const EXCLUDE  = (process.env.EXCLUDE ?? '1') !== '0';

// Stato runtime
let proc = null;
let win  = null;

// --- Crea finestra principale ---
app.whenReady().then(() => {
  win = new BrowserWindow({
    width:  720,
    height: 680,
    webPreferences: {
      nodeIntegration:       true,
      contextIsolation:      false,
      backgroundThrottling:  false,
    },
  });

  // Consenti richieste di permesso media (richiesto da AudioContext)
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // DevTools separati per non intralciare il layout
  win.webContents.openDevTools({ mode: 'detach' });

  // Carica la pagina con i parametri di configurazione
  const sr = 48000;
  const query = `?sr=${sr}&chunk=${CHUNK_MS}&mute=${MUTE ? '1' : '0'}`;
  win.loadFile(path.join(__dirname, 'index.html'), { search: query });
});

// --- Handler: renderer pronto a riprodurre audio ---
// Viene chiamato DOPO che AudioWorkletNode è connesso al destination,
// così l'Audio Service di Chromium è già vivo e compare nelle metriche.
ipcMain.handle('playback-ready', async () => {
  // Verifica che BIN sia impostato
  if (!BIN) {
    console.error('[spike-pipeline] BIN non impostato — imposta la variabile d\'ambiente BIN col path del binario audiotee');
    return { ok: false, error: 'BIN non impostato' };
  }

  // Raccogli metriche processi per trovare l'Audio Service
  const metrics = app.getAppMetrics();
  console.log('[spike-pipeline] processi Electron:', metrics.map(m => ({
    pid:         m.pid,
    type:        m.type,
    name:        m.name,
    serviceName: m.serviceName,
  })));

  const audioPids = metrics
    .filter(m => m.serviceName === 'audio.mojom.AudioService')
    .map(m => m.pid);

  console.log('[spike-pipeline] Audio Service PID:', audioPids);
  if (audioPids.length === 0 && EXCLUDE) {
    console.warn('[spike-pipeline] Nessun Audio Service trovato — excludeProcesses sarà vuoto.');
  }

  // Costruisci argomenti per il binario stereo
  const args = ['--stereo'];
  if (MUTE) args.push('--mute');
  if (EXCLUDE && audioPids.length) args.push('--exclude-processes', ...audioPids.map(String));
  args.push('--chunk-duration', String(CHUNK_MS / 1000));

  console.log('[spike-pipeline] spawn:', BIN, args);

  // Spawna il binario direttamente
  proc = spawn(BIN, args);

  // Stdout: chunk PCM float32 LE stereo interleaved → inoltrati al renderer
  proc.stdout.on('data', d => {
    if (win && !win.isDestroyed()) win.webContents.send('pcm', d);
  });

  // Stderr: righe JSON con diagnostica dal binario
  proc.stderr.on('data', d => {
    const raw = d.toString();
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.message_type === 'metadata') {
          console.log('[spike-pipeline] metadata:', obj);
        } else if (obj.message_type === 'error') {
          console.error('[spike-pipeline] errore binario:', obj);
        } else {
          // info, debug, stream_start, stream_stop — log sintetico
          console.log(`[spike-pipeline] ${obj.message_type ?? 'log'}:`, obj.message ?? line);
        }
      } catch (_) {
        // Riga non-JSON: logga grezza
        console.log('[spike-pipeline] stderr:', line);
      }
    }
  });

  proc.on('exit', (code, sig) => {
    console.log('[spike-pipeline] audiotee uscito', code, sig);
  });

  proc.on('error', err => {
    console.error('[spike-pipeline] spawn errore', err.message);
  });

  return { ok: true, audioPids, args };
});

// --- Handler: ferma la cattura manualmente ---
ipcMain.handle('stop-capture', () => {
  if (proc) {
    proc.kill('SIGTERM');
    proc = null;
  }
  return true;
});

// --- Pulizia alla chiusura della finestra ---
app.on('window-all-closed', () => {
  if (proc) {
    proc.kill('SIGTERM');
  }
  app.quit();
});
