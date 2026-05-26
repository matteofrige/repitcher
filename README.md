# RePitch — Real-Time Audio Pitch Shifter

A native macOS Electron app for real-time pitch shifting of system audio (Spotify, YouTube, etc.) **without affecting playback speed**.

## Features

- 🎵 **Real-time Pitch Shifting**: Adjust pitch from -12 to +12 semitones
- 🚀 **Zero Latency (mostly)**: Uses Web Audio API + Tone.js for low-latency processing
- 🎛️ **Quick Presets**: Standard, Capo 1-6, and semitone shifts
- 📊 **Live Visualizer**: Real-time frequency spectrum + waveform display
- 🔇 **Bypass Control**: Toggle processing on/off with a button
- 💅 **Beautiful Dark UI**: Modern, minimalist macOS design
- 🔒 **Safe & Private**: All processing happens locally, no network access

## System Requirements

- **macOS 11+** (Big Sur or later)
- **Apple Silicon or Intel** (native universal binary)
- **Microphone Permission** (required by the system)
- **BlackHole Audio Driver** (free loopback device)

## Installation

### 1. Install BlackHole (One-Time Setup)

BlackHole is a free, open-source loopback audio device. This is required for RePitch to intercept system audio.

**Download & Install:**
- Visit [existential.audio/blackhole](https://existential.audio/blackhole/)
- Download the latest `.pkg` installer
- Run the installer and follow the prompts
- **Restart your Mac** (required)

**Verify Installation:**
```bash
# List audio devices
system_profiler SPAudioDataType | grep -i blackhole
```

### 2. Create a Multi-Output Device (Optional but Recommended)

This allows audio to play through both BlackHole (for RePitch) and your speakers simultaneously.

1. Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup")
2. Click the **"+"** button at the bottom → "Create Multi-Output Device"
3. Check both:
   - Your speaker output device
   - **BlackHole 2ch**
4. Rename it to "RePitch Output" (optional)
5. Set it as your default output in System Settings > Sound

### 3. Install & Run RePitch

**Download the DMG:**
```bash
# Download the latest release from GitHub
# Or build from source (see below)
```

**From DMG:**
1. Download `RePitch-1.0.0.dmg`
2. Open the DMG
3. Drag **RePitch** to the **Applications** folder
4. Eject the DMG
5. Launch RePitch from Applications

**From Source:**
```bash
# Clone the repository
git clone <repo-url>
cd repitch

# Install dependencies
npm install

# For development
npm run dev

# For production build
npm run build-dmg
```

## Usage

### Basic Workflow

1. **Launch RePitch**
   - The app will auto-detect BlackHole if installed
   - You'll see "Connected to BlackHole 2ch" in the status bar

2. **Enable Processing**
   - Click the large circular **ON button** (top center)
   - The button will pulse when active

3. **Adjust Pitch**
   - Use the **slider** to shift pitch (-12 to +12 semitones)
   - Real-time preview on speakers
   - Visualizer shows live frequency spectrum

4. **Use Presets** (Optional)
   - Click **"Standard"** to reset to 0 semitones
   - Click **"Capo 1-6"** for quick musical shifts
   - Click **"-1, -2, -3 Semitones"** for downward shifts

5. **Bypass Processing**
   - Click **"BYPASS: OFF"** to temporarily disable pitch shifting
   - Useful for testing or quick A/B comparison

### Settings Audio Routing

**For Music + System Audio:**
1. System Settings > Sound > Output
2. Select your **"RePitch Output"** device
3. Now all system audio flows through BlackHole → RePitch → Speakers

**For Single Application Only:**
- Option-click the volume icon in the menu bar
- Select the app, then choose BlackHole 2ch as its output device

## Troubleshooting

### "No BlackHole device found"
- BlackHole is not installed or not recognized
- **Solution**: Download and install BlackHole from [existential.audio/blackhole](https://existential.audio/blackhole/)
- **After install**, restart your Mac completely

### "Connection failed" / "Microphone permission denied"
- macOS is blocking microphone access
- **Solution**: 
  1. System Settings > Privacy & Security > Microphone
  2. Add **RePitch** to the list
  3. Restart RePitch

### No sound coming through
- Audio routing not configured correctly
- **Solution**:
  1. Open **Audio MIDI Setup** (Spotlight → search)
  2. Check that BlackHole 2ch is selected in your Multi-Output Device
  3. Set that device as your system output in Sound settings

### Latency or audio dropouts
- Typically indicates buffer issues
- **Solution**:
  1. Try closing other audio apps (Spotify, Discord, etc.)
  2. Restart RePitch
  3. Check that your Mac's system load is not high (Activity Monitor)

### Audio is very quiet or distorted
- Input/output levels may be misaligned
- **Solution**:
  1. Open **Audio MIDI Setup**
  2. Click BlackHole 2ch input
  3. Ensure input level slider is in the middle (not maxed)

## Development

### Prerequisites
- Node.js 16+ (use `nvm` or Homebrew)
- npm or yarn
- Git

### Setup

```bash
# Clone and install
git clone <repo-url>
cd repitch
npm install

# Install Tone.js and other dependencies
npm install tone --save

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

# Output will be in: dist/RePitch-1.0.0.dmg

# Or just build the app (no DMG)
npm run build
```

### Project Structure

```
repitch/
├── src/
│   ├── App.tsx                 # Main React component
│   ├── index.tsx               # React entry point
│   ├── audioEngine.ts          # Tone.js audio processing
│   ├── presets.ts              # Preset configurations
│   ├── components/
│   │   ├── PitchControl.tsx    # Pitch slider + controls
│   │   ├── PresetButtons.tsx   # Preset button grid
│   │   └── Visualizer.tsx      # Frequency visualizer
│   ├── electron/
│   │   ├── main.ts             # Electron main process
│   │   └── preload.ts          # IPC bridge (security)
│   └── styles/
│       ├── App.css
│       ├── PitchControl.css
│       ├── PresetButtons.css
│       └── Visualizer.css
├── public/
│   ├── index.html
│   └── manifest.json
├── package.json                # Dependencies + scripts
└── README.md
```

### Key Dependencies

- **Electron 27+**: Cross-platform desktop app
- **React 18**: UI framework
- **Tone.js 14+**: Audio processing (pitch shifting)
- **electron-builder**: DMG packaging

### Architecture

**Signal Path:**
```
BlackHole Input (getUserMedia)
    ↓
Tone.PitchShift (no tempo change)
    ↓
AnalyserNode (visualizer)
    ↓
System Output (speakers/headphones)
```

**Key Features:**
- **Pitch Preservation**: FFmpeg-style time-stretching (via Tone.js)
- **Real-time**: ~50-200ms latency (depending on system)
- **Bypass Crossfade**: Smooth 30ms fade between dry/wet
- **No Artifacts**: AGC/echo cancellation disabled for clean audio

## Advanced Configuration

### Customizing Pitch Range

Edit `src/audioEngine.ts`:
```typescript
// Change these values to expand/contract range
const MIN_SEMITONES = -24;
const MAX_SEMITONES = 24;
```

### Changing Colors

Edit `src/styles/App.css` and update CSS variables:
```css
--accent: #64b5f6;  /* Slider color */
--success: #81c784; /* Active button color */
```

### Performance Tuning

In `src/audioEngine.ts`, adjust the pitch shifter:
```typescript
const pitch = new Tone.PitchShift({
  windowSize: 0.1,  // Increase for higher quality, higher latency
  feedback: 0,      // Feedback amount (0 = clean)
  wet: 1,           // Mix (1 = 100% processed)
});
```

## Uninstallation

```bash
# Remove the app
rm -rf /Applications/RePitch.app

# Optional: Uninstall BlackHole
# (if you don't use it with other apps)
# Restart your Mac after removal
```

## FAQ

**Q: Will this work with all audio apps?**  
A: Yes, if you route system audio through BlackHole. All audio goes through the same OS audio layer.

**Q: Is there a Windows version?**  
A: Not currently. The app uses macOS-specific audio APIs. A Windows/Linux port would require a complete rewrite using ASIO/ALSA.

**Q: Can I use this for live performances?**  
A: Yes, but test latency first. Typical latency is 50-100ms. For very low latency, reduce the `windowSize` parameter in `audioEngine.ts`.

**Q: Is my audio data private?**  
A: Completely. All processing happens locally on your Mac. The app does not send audio to any servers.

**Q: Can I pitch-shift while preserving tempo?**  
A: Yes, that's what RePitch does by default! Tone.js handles this automatically.

## License

MIT License — See LICENSE file for details

## Support

- **Issues**: GitHub Issues
- **Documentation**: See `BlackHole` docs at [existential.audio](https://existential.audio/blackhole/)
- **Tone.js Reference**: [tonejs.org](https://tonejs.org/)

## Credits

- **BlackHole Audio**: Open-source loopback audio driver by Existential Audio
- **Tone.js**: Web Audio API library by Yotam Mann
- **Electron**: Cross-platform app framework by GitHub

---

**Enjoy beautiful pitch shifting!** 🎵✨
