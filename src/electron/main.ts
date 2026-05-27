import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  shell,
  systemPreferences,
  session,
  net,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import isDev from 'electron-is-dev';

// Enable SharedArrayBuffer for the ring buffer shared with the AudioWorklet.
// Must be set before app.whenReady.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let splash: BrowserWindow | null = null;
let isQuitting = false;

// macOS native audio capture state
let captureProc: ChildProcess | null = null;
let capturePidWatch: NodeJS.Timeout | null = null;

function audioteeBinaryPath(): string {
  return isDev
    ? path.join(__dirname, '..', '..', 'resources', 'bin', 'audiotee')
    : path.join(process.resourcesPath, 'bin', 'audiotee');
}

function findAudioServicePid(): number | null {
  const metrics = app.getAppMetrics();
  const match = metrics.find((m) => m.serviceName === 'audio.mojom.AudioService');
  return match ? match.pid : null;
}

/** Log audiotee's structured JSON stderr (one message per line). */
function logAudioteeStderr(d: Buffer): void {
  for (const line of d.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { message_type?: string; message?: string };
      if (obj.message_type === 'error') console.error('[repitch] audiotee error:', obj);
      else console.log(`[repitch] audiotee ${obj.message_type ?? 'log'}:`, obj.message ?? line);
    } catch {
      console.log('[repitch] audiotee stderr:', line);
    }
  }
}

/**
 * Spawn the audiotee binary in stereo, muting system audio and excluding our own
 * Audio Service process (so our playback isn't recaptured), forwarding PCM to the
 * renderer. Returns the child process.
 */
function spawnAudiotee(excludePid: number | null, sender: Electron.WebContents): ChildProcess {
  const args = ['--stereo', '--mute'];
  if (excludePid !== null) args.push('--exclude-processes', String(excludePid));
  args.push('--chunk-duration', '0.01');
  console.log('[repitch] spawn audiotee', audioteeBinaryPath(), args);

  const proc = spawn(audioteeBinaryPath(), args);
  proc.stdout.on('data', (d: Buffer) => {
    if (!sender.isDestroyed()) sender.send('repitch:pcm', d);
  });
  proc.stderr.on('data', logAudioteeStderr);
  proc.on('exit', (code, sig) => {
    console.log('[repitch] audiotee exited', code, sig);
    if (captureProc === proc) captureProc = null;
  });
  proc.on('error', (err) => console.error('[repitch] audiotee spawn error:', err.message));
  return proc;
}

/** Stop the capture process and its PID watcher (idempotent). */
function stopCapture(): void {
  if (capturePidWatch) {
    clearInterval(capturePidWatch);
    capturePidWatch = null;
  }
  if (captureProc) {
    captureProc.kill('SIGTERM');
    captureProc = null;
  }
}

// Self-hosted update feed (no third-party service, no signing required — this
// is a "check + download + open installer" flow, NOT silent auto-install).
// DEMO URL — replace with your real endpoint when ready.
const UPDATE_FEED_URL = 'https://updates.repitch.app/latest.json';

interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

/** Returns >0 if a > b, <0 if a < b, 0 if equal. Semver "x.y.z". */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    let data = '';
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 400) {
        reject(new Error(`HTTP ${status}`));
        return;
      }
      res.on('data', (chunk) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Check the feed; return update info only if a newer version is available. */
async function checkForUpdate(): Promise<UpdateInfo | null> {
  const raw = (await fetchJson(UPDATE_FEED_URL)) as Partial<UpdateInfo> | null;
  if (
    raw &&
    typeof raw.version === 'string' &&
    typeof raw.url === 'string' &&
    compareVersions(raw.version, app.getVersion()) > 0
  ) {
    return { version: raw.version, url: raw.url, notes: typeof raw.notes === 'string' ? raw.notes : '' };
  }
  return null;
}

/** Download the installer to ~/Downloads, reporting progress (0..1). */
function downloadUpdate(url: string, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 400) {
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      let fileName = 'RePitch-update';
      try {
        fileName = path.basename(new URL(url).pathname) || fileName;
      } catch {
        /* keep default */
      }
      const filePath = path.join(app.getPath('downloads'), fileName);
      const out = fs.createWriteStream(filePath);
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        out.write(chunk);
        if (total > 0) onProgress(received / total);
      });
      res.on('end', () => {
        out.end(() => resolve(filePath));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function assetsDir(): string {
  return isDev ? path.join(__dirname, '../../assets') : path.join(process.resourcesPath, 'assets');
}

function closeSplash(): void {
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null;
}

/** Brief startup splash showing the RePitch logo until the main window is ready. */
function createSplash(): void {
  let imgSrc = '';
  try {
    const b64 = fs.readFileSync(path.join(assetsDir(), 'splash.png')).toString('base64');
    imgSrc = `data:image/png;base64,${b64}`;
  } catch {
    return; // no splash asset — skip silently
  }
  splash = new BrowserWindow({
    width: 360,
    height: 360,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    skipTaskbar: true,
  });
  const html = `<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:transparent;overflow:hidden;-webkit-app-region:drag"><img src="${imgSrc}" style="width:300px;height:300px;border-radius:28px;box-shadow:0 24px 70px rgba(0,0,0,.55)"/></body></html>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  splash.once('ready-to-show', () => splash?.show());
  // Safety: never leave the splash hanging if the main window stalls.
  setTimeout(closeSplash, 10000);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    title: 'RePitch',
    backgroundColor: '#0b0e14',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      // Keep timers/audio scheduling running at full rate when the window is
      // hidden, so the active function keeps working in the background.
      backgroundThrottling: false,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../../build/index.html')}`;

  mainWindow.loadURL(startUrl).catch((err) => {
    console.error('Failed to load URL:', err);
  });

  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow?.show();
    // Quietly check for updates a few seconds after launch.
    setTimeout(async () => {
      try {
        const info = await checkForUpdate();
        if (info) mainWindow?.webContents.send('repitch:update-available', info);
      } catch {
        /* offline / no feed — ignore */
      }
    }, 3000);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Open external links in the default browser instead of inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing the window HIDES it instead of destroying it, so the active
  // function (pitch shift / tuner / metronome) keeps running in the background.
  // The app is reopened from the menu-bar tray. Real quit goes through the tray
  // "Quit" item or app before-quit (isQuitting).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function trayIconPath(): string {
  return path.join(assetsDir(), 'trayTemplate.png');
}

function createTray(): void {
  if (tray) return;
  const image = nativeImage.createFromPath(trayIconPath());
  if (!image.isEmpty()) image.setTemplateImage(true);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('RePitch');

  const menu = Menu.buildFromTemplate([
    { label: 'Open RePitch', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  // Left-click reopens the window; right-click shows the menu (macOS).
  tray.on('click', () => showWindow());
  tray.on('right-click', () => tray?.popUpContextMenu(menu));
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'RePitch',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        ...(process.platform === 'darwin'
          ? ([
              {
                label: 'Open Privacy: Audio Recording',
                click: () => {
                  shell.openExternal(
                    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
                  );
                },
              },
              {
                label: 'Open Audio MIDI Setup',
                click: () => {
                  shell.openExternal(
                    'file:///System/Applications/Utilities/Audio%20MIDI%20Setup.app'
                  );
                },
              },
            ] as Electron.MenuItemConstructorOptions[])
          : ([
              {
                label: 'Loopback Device Setup (VB-CABLE)',
                click: () => {
                  shell.openExternal('https://vb-audio.com/Cable/');
                },
              },
            ] as Electron.MenuItemConstructorOptions[])),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC handlers for system integrations the renderer cannot do itself.
function registerIpcHandlers(): void {
  ipcMain.handle('repitch:open-external', async (_event, url: string) => {
    if (typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('repitch:open-audio-midi-setup', async () => {
    await shell.openExternal('file:///System/Applications/Utilities/Audio%20MIDI%20Setup.app');
    return true;
  });

  ipcMain.handle('repitch:get-mic-access-status', async () => {
    if (process.platform !== 'darwin') return 'granted';
    return systemPreferences.getMediaAccessStatus('microphone');
  });

  ipcMain.handle('repitch:request-mic-access', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  // Info shown next to the menu-bar icon (pitch value / tuner note / BPM).
  ipcMain.on('repitch:set-tray-info', (_event, text: string) => {
    if (tray && typeof text === 'string') tray.setTitle(text ? ` ${text}` : '');
  });

  // Show / hide the menu-bar icon from Settings.
  ipcMain.on('repitch:set-tray-visible', (_event, visible: boolean) => {
    if (visible) {
      createTray();
    } else if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  // Self-hosted updates: check the feed, and download + open the installer.
  ipcMain.handle('repitch:check-update', async () => {
    try {
      return await checkForUpdate();
    } catch {
      return null;
    }
  });

  ipcMain.handle('repitch:download-update', async (event, url: string) => {
    const wc = event.sender;
    const filePath = await downloadUpdate(url, (p) => wc.send('repitch:update-progress', p));
    await shell.openPath(filePath);
    return filePath;
  });

  ipcMain.handle('repitch:get-platform', async () => {
    return {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    };
  });

  // macOS native audio capture via the audiotee binary.
  ipcMain.handle('repitch:start-capture', async (event) => {
    if (process.platform !== 'darwin') return { ok: false, error: 'macOS only' };
    stopCapture();

    // The Audio Service process (which we exclude from the tap) only exists once
    // the renderer is producing audio — poll briefly for it.
    let pid: number | null = null;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      pid = findAudioServicePid();
      if (pid !== null) break;
      await new Promise<void>((res) => setTimeout(res, 100));
    }
    if (pid === null) {
      console.warn('[repitch] Audio Service PID not found — capturing without exclusion');
    }

    let excludedPid = pid;
    captureProc = spawnAudiotee(pid, event.sender);

    // Chromium can restart the Audio Service under a new PID; respawn to keep
    // excluding our own output (otherwise it would feed back into the tap).
    capturePidWatch = setInterval(() => {
      if (!captureProc) return;
      const newPid = findAudioServicePid();
      if (newPid !== null && newPid !== excludedPid) {
        console.log(`[repitch] Audio Service PID ${excludedPid} -> ${newPid}, respawning`);
        captureProc.kill('SIGTERM');
        excludedPid = newPid;
        captureProc = spawnAudiotee(newPid, event.sender);
      }
    }, 2000);

    return { ok: true, pid };
  });

  ipcMain.handle('repitch:stop-capture', async () => {
    stopCapture();
    return true;
  });
}

app.whenReady().then(() => {
  // Request microphone access up front (used by the Tuner) so a fresh install
  // gets the OS prompt. The pitch capture uses the separate audio-capture grant.
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }

  // Auto-grant microphone permission inside the WebContents so getUserMedia works
  // (macOS still enforces the OS-level permission separately).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
      return;
    }
    callback(false);
  });

  registerIpcHandlers();
  buildAppMenu();
  createSplash();
  createWindow();
  createTray();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  stopCapture();
});

app.on('window-all-closed', () => {
  stopCapture();
  // On macOS the app stays alive in the menu bar (window is hidden, not closed),
  // so functionality keeps running. Only quit on other platforms.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Harden navigation: prevent renderer from being navigated to arbitrary origins.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsed = new URL(navigationUrl);
    const allowedDevHost = parsed.protocol === 'http:' && parsed.host === 'localhost:3000';
    const allowedFile = parsed.protocol === 'file:';
    if (!allowedDevHost && !allowedFile) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
});
