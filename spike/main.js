/**
 * spike/main.js — Harness di test per electron-audio-loopback
 *
 * Verifica se la cattura loopback di sistema ri-cattura l'audio prodotto
 * dalla stessa app (auto-cattura → rischio eco Larsen).
 *
 * Env vars:
 *   FORCE_CATAP=0|1  (default: 0 → ScreenCaptureKit; 1 → Core Audio Tap)
 *   MUTE=0|1         (default: 1 → muta l'audio originale alla sorgente)
 */

const { app, BrowserWindow, session, systemPreferences } = require('electron');
const path = require('path');

// Leggi env vars e converti in boolean
const FORCE_CATAP = (process.env.FORCE_CATAP || '0') === '1';
const MUTE       = (process.env.MUTE       || '1') === '1';

// initMain DEVE essere chiamato PRIMA di app.whenReady()
const { initMain } = require('electron-audio-loopback');
initMain({
  forceCoreAudioTap: FORCE_CATAP,
  loopbackWithMute:  MUTE,
});

console.log(`[spike] Config: forceCoreAudioTap=${FORCE_CATAP}, loopbackWithMute=${MUTE}`);

app.whenReady().then(() => {
  // DIAGNOSTICA TCC: stato dei permessi macOS visto dal sistema operativo.
  try {
    console.log(`[spike] TCC screen     = ${systemPreferences.getMediaAccessStatus('screen')}`);
    console.log(`[spike] TCC microphone = ${systemPreferences.getMediaAccessStatus('microphone')}`);
  } catch (e) {
    console.log('[spike] getMediaAccessStatus errore:', e.message);
  }

  // Concedi automaticamente i permessi media e display-capture
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log(`[spike] permissionRequest: ${permission}`);
    const granted = permission === 'media' || permission === 'display-capture';
    callback(granted);
  });

  const win = new BrowserWindow({
    width: 720,
    height: 720,
    title: 'Spike — Loopback Auto-Cattura Test',
    webPreferences: {
      nodeIntegration:      true,
      contextIsolation:     false,
      backgroundThrottling: false,
    },
  });

  // Passa la config come query string per renderizzarla nella UI
  win.loadFile(path.join(__dirname, 'index.html'), {
    query: {
      catap: FORCE_CATAP ? '1' : '0',
      mute:  MUTE        ? '1' : '0',
    },
  });

  // DevTools in modalità detach (non blocca la finestra principale)
  win.webContents.openDevTools({ mode: 'detach' });
});

// Lifecycle standard: chiudi l'app quando tutte le finestre sono chiuse
app.on('window-all-closed', () => {
  app.quit();
});
