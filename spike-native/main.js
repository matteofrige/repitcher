'use strict';
// spike-native/main.js — harness di spike per validare audiotee (cattura nativa audio di sistema)
// SOLO per testing; non toccare i file esistenti del progetto.

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

// ---- Leggi variabili d'ambiente ----
const EXCLUDE   = process.env.EXCLUDE   !== '0';          // default true (esclude i PID di questa app)
const MUTE      = process.env.MUTE      !== '0';          // default true (silenzia l'originale)
const CHUNK_MS  = parseInt(process.env.CHUNK_MS  || '20', 10);
const SR        = parseInt(process.env.SR        || '48000', 10);

// Stato modulo: istanza AudioTee attiva
let audiotee = null;
// Riferimento alla finestra principale (serve per inviare RMS via IPC)
let win = null;

// ---- Timestamp dell'ultimo log RMS su console (throttle ~500ms) ----
let lastRmsLog = 0;

// ---- Crea la finestra principale ----
function createWindow() {
  // Autorizza richieste di permesso media e display-capture dal renderer
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' || permission === 'display-capture');
  });

  win = new BrowserWindow({
    width: 720,
    height: 760,
    title: 'spike-native — audiotee test',
    webPreferences: {
      nodeIntegration:      true,
      contextIsolation:     false,
      backgroundThrottling: false,
    },
  });

  // Passa la config alla pagina tramite query string
  const qExclude = EXCLUDE ? '1' : '0';
  const qMute    = MUTE    ? '1' : '0';
  const indexPath = path.join(__dirname, 'index.html');
  win.loadFile(indexPath, { query: { exclude: qExclude, mute: qMute } });

  // Apri DevTools in finestra separata per non interferire con la UI
  win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => { win = null; });
}

// ---- Handler IPC: avvia la cattura nativa ----
ipcMain.handle('start-capture', async () => {
  try {
    // Recupera i processi attivi di questa istanza Electron
    const metrics = app.getAppMetrics();
    console.log(
      '[spike-native] AppMetrics:',
      metrics.map(m => ({ pid: m.pid, type: m.type, name: m.name, serviceName: m.serviceName }))
    );

    // Escludi SOLO il processo audio di Chromium (audio.mojom.AudioService):
    // è l'unico che produce l'output dell'app ed è l'unico traducibile in audio
    // object da Core Audio. Passare PID che non hanno mai prodotto audio fa
    // fallire audiotee ("Failed to translate process IDs to audio objects").
    const audioPids = metrics
      .filter(m => m.serviceName === 'audio.mojom.AudioService')
      .map(m => m.pid);
    const excludeProcesses = EXCLUDE ? audioPids : [];
    if (EXCLUDE && audioPids.length === 0) {
      console.warn('[spike-native] ATTENZIONE: Audio Service non trovato — avvia prima il tono così nasce il processo audio.');
    }
    console.log(
      `[spike-native] excludeProcesses (EXCLUDE=${EXCLUDE}):`,
      excludeProcesses.length ? excludeProcesses : '[] — nessuna esclusione'
    );

    // Import dinamico (audiotee è ESM-only; da CJS serve dynamic import)
    const { AudioTee } = await import('audiotee');

    audiotee = new AudioTee({
      sampleRate:       SR,
      chunkDurationMs:  CHUNK_MS,
      mute:             MUTE,
      excludeProcesses,
    });

    // ---- Collega gli eventi di log/stato ----
    audiotee.on('log', (level, msgData) => {
      console.log(`[spike-native][log:${level}]`, msgData.message,
        msgData.context ? JSON.stringify(msgData.context) : '');
    });
    audiotee.on('start', () => {
      console.log('[spike-native] cattura avviata');
    });
    audiotee.on('stop', () => {
      console.log('[spike-native] cattura fermata');
    });
    audiotee.on('error', (err) => {
      console.error('[spike-native] errore audiotee:', err.message);
    });

    // ---- Handler dati PCM: calcola RMS e invia al renderer ----
    // Il Buffer è PCM Int16LE mono (perché sampleRate è impostato).
    audiotee.on('data', ({ data }) => {
      const sampleCount = Math.floor(data.length / 2); // 2 byte per campione Int16
      if (sampleCount === 0) return;

      let sumSq = 0;
      for (let i = 0; i < sampleCount; i++) {
        // Legge campione Int16LE, normalizza in [-1, 1]
        const s = data.readInt16LE(i * 2) / 32768;
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / sampleCount);

      // Invia RMS al renderer (ogni chunk, ~CHUNK_MS ms)
      if (win && !win.isDestroyed()) {
        win.webContents.send('rms', rms);
      }

      // Log su console throttlato a ~500ms
      const now = Date.now();
      if (now - lastRmsLog >= 500) {
        console.log(`[spike-native] RMS: ${rms.toFixed(4)}`);
        lastRmsLog = now;
      }
    });

    await audiotee.start();

    return { ok: true, excludeCount: excludeProcesses.length };
  } catch (err) {
    console.error('[spike-native] start-capture fallito:', err);
    audiotee = null;
    return { ok: false, error: err.message };
  }
});

// ---- Handler IPC: ferma la cattura ----
ipcMain.handle('stop-capture', async () => {
  if (audiotee) {
    try {
      await audiotee.stop();
    } catch (err) {
      console.error('[spike-native] stop-capture errore:', err.message);
    }
    audiotee = null;
  }
  return true;
});

// ---- Lifecycle app ----
app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  // Ferma la cattura prima di uscire per evitare processi zombie
  if (audiotee) {
    try { await audiotee.stop(); } catch (_) {}
    audiotee = null;
  }
  app.quit();
});
