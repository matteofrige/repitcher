# RePitch — Development Reference

## Status

READY FOR DEVELOPMENT & TESTING

All source files are in place, dependencies are installed, and the build system is configured.

---

## What's Included

### Core Application Files

- `src/App.tsx` — Main React app with audio engine control
- `src/components/PitchControl.tsx` — Main pitch control interface
- `src/components/PresetButtons.tsx` — Quick preset buttons
- `src/components/Visualizer.tsx` — Real-time frequency visualizer
- `src/audioEngine.ts` — Audio processing (Signalsmith WASM pitch shifter)
- `src/electron/main.ts` — Electron main process + IPC with audiotee (macOS)
- `src/electron/preload.ts` — IPC security bridge

### Styling (Dark Mode UI)

- `src/styles/App.css` — Main app styling (charcoal/midnight theme)
- `src/styles/PitchControl.css` — Pitch slider + power button
- `src/styles/PresetButtons.css` — Preset grid
- `src/styles/Visualizer.css` — Canvas visualizer styling
- `src/styles/index.css` — Global design tokens

### Native Binary (macOS)

- `resources/bin/audiotee` — Small native binary that taps system audio via Core Audio process taps (macOS 14.2+). Spawned by the Electron main process; streams raw PCM on stdout, which main forwards to the renderer over IPC. No loopback driver required.

### Configuration

- `package.json` — All dependencies
- `tsconfig.json` — TypeScript configuration
- `tsconfig.electron.json` — Electron-specific TypeScript config
- `README.md` — Full setup + usage documentation
- `.gitignore` — Git ignore rules

---

## Architecture

### Signal Path

**macOS (native, no loopback driver):**
```
System audio
    ↓
audiotee (Core Audio process tap — mutes system audio at source)
    ↓
PCM via IPC socket
    ↓
AudioWorklet ring buffer (renderer process)
    ↓
Signalsmith pitch shifter (WASM)
    ↓
setSinkId → physical output (speakers/headphones)
```

**Windows / Linux (loopback device):**
```
Loopback device (VB-CABLE Output on Windows / PulseAudio Monitor on Linux)
    ↓
getUserMedia
    ↓
Signalsmith pitch shifter (WASM)
    ↓
setSinkId → physical output (speakers/headphones)
```

### macOS Audio Capture Details

RePitch uses Apple's Core Audio "process tap" API (available from macOS 14.2) to capture system audio output at the OS level. The `audiotee` binary:

1. Opens a process tap on the system audio mix (excluding its own PID and the audio service process).
2. Mutes the original system audio output so only the pitch-shifted version is heard.
3. Streams raw PCM (Float32, 48 kHz, stereo) to the Electron main process via a Unix socket / IPC pipe.
4. The Electron main process forwards the PCM to the renderer via `ipcRenderer`, where an AudioWorklet feeds it into the Signalsmith pitch shifter.

This approach requires the **audio recording entitlement** (`com.apple.security.device.audio-input`), which triggers the macOS microphone permission prompt on first launch.

There is no BlackHole, Multi-Output Device, or any other virtual audio device involved on macOS.

### Tuner

The built-in chromatic tuner uses `getUserMedia` with the microphone selected in Settings. Pitch shifting is suspended while the Tuner is active (they are mutually exclusive to avoid feedback loops).

---

## Development Workflow

### Prerequisites

- Node.js 18+ (use `nvm` or Homebrew)
- npm
- macOS 14.2+ for macOS-specific audio features
- Xcode Command Line Tools (for building `audiotee` from source if needed)

### Running in Development

```bash
cd ~/Projects/repitch
npm run dev
```

This will:
- Start the React dev server (http://localhost:3000)
- Start Electron connected to the dev server
- Open DevTools automatically
- Hot-reload on file changes

On macOS, `audiotee` is spawned automatically by the main process. Grant the audio recording permission when prompted.

On Windows/Linux, ensure a loopback device (VB-CABLE / Monitor source) is active and selected as system output before testing.

### Testing Audio

1. Click the large ON button to start audio processing.
2. Play audio in any app (Spotify, browser video, etc.).
3. Move the Pitch Slider (-12 to +12 semitones).
4. Try Preset Buttons (Standard, Capo 1-6).
5. Watch the Visualizer show real-time frequency spectrum.
6. Click BYPASS to toggle pitch shifting on/off.
7. Switch to the Tuner tab — pitch processing should stop and the tuner should respond to microphone input.

### Building for Distribution

```bash
# Create DMG installer (macOS)
cd ~/Projects/repitch
npm run build-dmg
```

Output: `release/RePitch-x.y.z.dmg`

---

## Key Engine Details

- Pitch shifting: Signalsmith Stretch (WASM) — semitone-accurate, no tempo change
- Audio capture (macOS): Core Audio process tap via `audiotee` (Float32, 48 kHz, stereo)
- Audio capture (Win/Linux): `getUserMedia` on loopback/monitor device
- Latency: ~50-200ms depending on buffer size and platform
- Visualizer: FFT 2048, smoothing 0.82, 60 FPS canvas rendering
- Bypass: 30ms equal-power crossfade between dry/wet

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server + Electron (hot-reload) |
| `npm run build` | Build React + compile Electron |
| `npm run build-dmg` | Create DMG installer for distribution |
| `npm run pack` | Pack without signing (local testing) |
| `npm start` | React only (no Electron) |

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **electron** | 42.x | Desktop app framework |
| **react** | 18.x | UI framework |
| **react-dom** | 18.x | React DOM renderer |
| **electron-builder** | 24.x | DMG packaging |
| **TypeScript** | 5.x | Type-safe JavaScript |

Pitch shifting is provided by Signalsmith Stretch (WASM), bundled in `public/`.

---

## File Locations

```
~/Projects/repitch/
├── src/
│   ├── App.tsx
│   ├── audioEngine.ts
│   ├── presets.ts
│   ├── index.tsx
│   ├── components/
│   │   ├── PitchControl.tsx
│   │   ├── PresetButtons.tsx
│   │   └── Visualizer.tsx
│   ├── electron/
│   │   ├── main.ts              (spawns audiotee, handles IPC)
│   │   └── preload.ts           (IPC bridge)
│   └── styles/
│       ├── App.css
│       ├── PitchControl.css
│       ├── PresetButtons.css
│       ├── Visualizer.css
│       └── index.css
├── public/
│   └── index.html
├── resources/
│   └── audiotee                 (macOS native binary)
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

---

## Known Limitations / Future Work

- [ ] Icon asset (assets/icon.icns) — currently using default
- [ ] Notarization for distribution (optional, app works without it locally)
- [ ] Auto-update mechanism (electron-updater)
- [ ] Custom app signing (required for distribution outside GitHub releases)
- [ ] Preferences/settings persistence across restarts

---

**Project**: RePitch  
**Status**: Development Active  
**Location**: ~/Projects/repitch
