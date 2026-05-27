# RePitch — Real-Time Audio Pitch Shifter

A native macOS Electron app for real-time pitch shifting of system audio (Spotify, YouTube, etc.) **without affecting playback speed**.

## Features

- Real-time Pitch Shifting: Adjust pitch from -12 to +12 semitones
- Zero Latency (mostly): Uses Web Audio API + Signalsmith WASM for low-latency processing
- Quick Presets: Standard, Capo 1-6, and semitone shifts
- Live Visualizer: Real-time frequency spectrum + waveform display
- Bypass Control: Toggle processing on/off with a button
- Built-in Chromatic Tuner: Uses the microphone selected in Settings (mutually exclusive with pitch shifting)
- Beautiful Dark UI: Modern, minimalist design
- Safe & Private: All processing happens locally, no network access

## System Requirements

### macOS
- **macOS 14.2 or later** (Sonoma 14.2+) — required for Core Audio process taps
- Apple Silicon or Intel (native universal binary)
- **No third-party drivers required**

### Windows
- Windows 10/11
- **VB-CABLE** virtual audio device (free) — set as system audio output

### Linux
- PulseAudio or PipeWire
- A **Monitor** loopback source configured as the capture device

## Installation

### macOS

1. Download `RePitch.dmg` from the latest GitHub release (or build from source).
2. Open the DMG, drag **RePitch** to Applications, and launch it.
3. On first launch macOS will ask for **microphone / audio recording permission** — grant it. This is required for the Core Audio tap to capture system audio.
4. That's it. No BlackHole, no Multi-Output Device, no restart needed.

> **Note**: macOS 14.2+ is required. The app uses the Core Audio "process tap" API (introduced in 14.2) via a small included native binary (`audiotee`) to capture system audio without a loopback driver.

### Windows

1. Install **VB-CABLE** from [vb-audio.com/Cable](https://vb-audio.com/Cable/) and restart.
2. Set **CABLE Input** as your default audio output in Sound settings.
3. Launch RePitch — it will capture from CABLE Output automatically.

### Linux

1. Identify your monitor source with `pactl list sources` (PulseAudio) or `pw-cli ls Node` (PipeWire).
2. In RePitch Settings, select the Monitor source as the input device.

### Build from Source

```bash
git clone <repo-url>
cd repitch
npm install

# Development
npm run dev

# Production DMG (macOS)
npm run build-dmg
```

## Usage

### Basic Workflow

1. **Launch RePitch**
   - On macOS the pitch shifter starts automatically; system audio is muted at the OS level and re-emitted pitch-shifted through your selected output.
   - On Windows/Linux ensure your loopback device is set as system output before launching.

2. **Adjust Pitch**
   - Use the **slider** to shift pitch (-12 to +12 semitones).
   - Real-time preview on speakers.
   - Visualizer shows live frequency spectrum.

3. **Use Presets** (Optional)
   - Click **"Standard"** to reset to 0 semitones.
   - Click **"Capo 1-6"** for quick musical shifts.
   - Click **"-1, -2, -3 Semitones"** for downward shifts.

4. **Bypass Processing**
   - Click **"BYPASS: OFF"** to temporarily disable pitch shifting.
   - Useful for quick A/B comparison.

5. **Tuner**
   - Switch to the Tuner tab to use the built-in chromatic tuner.
   - Pitch shifting stops while the tuner is active.
   - The tuner captures from the microphone selected in Settings.

### Settings

- **Output device**: where pitched audio is sent (your speakers or headphones).
- **Microphone** (Tuner input): only relevant when using the Tuner tab.

## Troubleshooting

### macOS: no pitched audio

- Check that RePitch has the **audio recording permission**: System Settings > Privacy & Security > Microphone — RePitch must be listed and enabled.
- If the permission was denied at first launch, revoke and re-grant it, then restart the app.

### macOS: permission dialog never appeared

- Quit RePitch, open Terminal and run:
  ```bash
  tccutil reset Microphone com.repitch.app
  ```
  Then re-launch RePitch.

### Windows: no audio or wrong source

- Make sure **CABLE Input** (VB-CABLE) is selected as the default playback device in Windows Sound settings.
- Confirm **CABLE Output** is what RePitch is capturing (check the input selector in Settings).

### Linux: no audio or wrong source

- Select the correct **Monitor** source in RePitch Settings (it must correspond to the sink your apps are playing to).

### Latency or audio dropouts (all platforms)

- Close other audio-intensive apps.
- Restart RePitch.
- Check CPU load in Activity Monitor / Task Manager.

### Audio is distorted

- Reduce the pitch shift amount and check that your system output volume is not at 100% before reaching RePitch.

## Architecture

### Signal Path

**macOS:**
```
System audio
    ↓
audiotee (Core Audio process tap — system audio muted at source)
    ↓
PCM samples via IPC
    ↓
AudioWorklet ring buffer
    ↓
Signalsmith pitch shifter (WASM)
    ↓
setSinkId → physical output (speakers/headphones)
```

**Windows / Linux:**
```
Loopback device (VB-CABLE Output / PulseAudio Monitor)
    ↓
getUserMedia
    ↓
Signalsmith pitch shifter (WASM)
    ↓
setSinkId → physical output (speakers/headphones)
```

### Key Technologies

- **Electron**: Cross-platform desktop shell
- **React 18**: UI framework
- **Signalsmith Stretch (WASM)**: Pitch shifting without tempo change
- **Core Audio process tap** (macOS): system-level audio capture via `audiotee` native binary
- **electron-builder**: DMG/installer packaging

### Project Structure

```
repitch/
├── src/
│   ├── App.tsx                 # Main React component
│   ├── index.tsx               # React entry point
│   ├── audioEngine.ts          # Audio processing
│   ├── presets.ts              # Preset configurations
│   ├── components/
│   │   ├── PitchControl.tsx    # Pitch slider + controls
│   │   ├── PresetButtons.tsx   # Preset button grid
│   │   └── Visualizer.tsx      # Frequency visualizer
│   ├── electron/
│   │   ├── main.ts             # Electron main process
│   │   └── preload.ts          # IPC bridge (security)
│   └── styles/
├── public/
│   └── index.html
├── resources/
│   └── audiotee                # Native binary (macOS Core Audio tap)
├── package.json
└── README.md
```

## Development

### Prerequisites

- Node.js 18+ (use `nvm` or Homebrew)
- npm
- Git
- macOS 14.2+ (for macOS-specific features)

### Setup

```bash
git clone <repo-url>
cd repitch
npm install

# Start development server
npm run dev

# This will:
# 1. Start React dev server on http://localhost:3000
# 2. Start Electron app connected to dev server
# 3. Open DevTools automatically
```

### Build for Production

```bash
# Build the React app + package as DMG
npm run build-dmg

# Or just build the app (no DMG)
npm run build
```

See `DEVELOPMENT.md` for more details on the development workflow and architecture.

## Advanced Configuration

### Customizing Pitch Range

Edit `src/audioEngine.ts`:
```typescript
const MIN_SEMITONES = -24;
const MAX_SEMITONES = 24;
```

### Changing Colors

Edit `src/styles/App.css` and update CSS variables:
```css
--accent: #64b5f6;  /* Slider color */
--success: #81c784; /* Active button color */
```

## Uninstallation

```bash
# Remove the app
rm -rf /Applications/RePitch.app
```

No driver or virtual device was installed on macOS, so nothing else to remove.

## FAQ

**Q: Do I need to install BlackHole or any other audio driver on macOS?**
No. RePitch captures system audio natively using the Core Audio process tap API. No third-party drivers are needed.

**Q: Why does macOS ask for microphone permission?**
The Core Audio process tap API requires the audio recording entitlement. No actual microphone audio is captured during pitch shifting — only system audio playback. The microphone is only used by the built-in Tuner.

**Q: Will this work with all audio apps on macOS?**
Yes. The process tap operates at the system audio level, so it captures audio from all apps regardless of which output device they use.

**Q: Is there a Windows version?**
Yes. On Windows, RePitch uses VB-CABLE as a loopback device. See the Installation section.

**Q: Can I use this for live performances?**
Yes, but test latency first. Typical latency is 50-150ms. For lower latency, reduce the buffer size in Settings.

**Q: Is my audio data private?**
Completely. All processing happens locally. The app does not send audio to any servers.

**Q: Can I pitch-shift while preserving tempo?**
Yes, that is what RePitch does by default. Signalsmith Stretch handles pitch shifting independently of tempo.

**Q: What is the Tuner and can I use it at the same time as pitch shifting?**
The Tuner is a built-in chromatic tuner that uses your selected microphone. Pitch shifting and the Tuner are mutually exclusive — switching to the Tuner pauses pitch processing, and switching back resumes it.

## License

MIT License — See LICENSE file for details

## Support

- **Issues**: GitHub Issues

## Credits

- **Signalsmith Stretch**: High-quality pitch/time library by Signalsmith Audio
- **audiotee**: Core Audio process tap binary for system audio capture (macOS)
- **Electron**: Cross-platform app framework by GitHub
- **VB-CABLE**: Virtual audio cable by VB-Audio Software (Windows)

---

Enjoy beautiful pitch shifting!
