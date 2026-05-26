# Signalsmith Stretch — WASM pitch-shifter (live)

High-quality, MIT-licensed real-time pitch shifting compiled to WebAssembly and
driven from an AudioWorklet. Replaces the in-house phase vocoder for maximum
audio fidelity on the live capture stream.

## Files

| File | Role |
|---|---|
| `stretch_wrapper.cpp` | Tiny `extern "C"` wrapper over `SignalsmithStretch<float>` |
| `stretch-processor.js` | AudioWorklet processor that drives the WASM, block by block |
| `build.sh` | Fetches Signalsmith source + compiles + assembles the worklet |
| *(generated)* `../public/signalsmith-worklet.js` | What the app loads at runtime |

## One-time: install Emscripten

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh    # run in each new shell so `emcc` is on PATH
```

## Build

```bash
cd wasm
./build.sh
```

This produces `public/signalsmith-worklet.js` (a single self-contained file with
the WASM embedded — no separate `.wasm`, no runtime fetch, works inside the
AudioWorklet scope).

## After a successful build

Tell me it built, and I'll flip the engine over to the
`signalsmith-stretch-processor` worklet (small change in `src/audioEngine.ts`):
the pitch param becomes `semitones` (set directly to the effective pitch) and we
drop the in-house phase-vocoder path. Then we test the sound and iterate.

## Notes / troubleshooting

- **Include path**: if compilation can't find DSP headers, add `-I signalsmith-stretch/dsp`
  to the `emcc` line in `build.sh` (already hinted at the end of the script).
- **C++ standard**: uses `-std=c++17`; lower to `c++14` only if the toolchain complains.
- **Latency**: Signalsmith introduces algorithmic latency (query via
  `stretch_input_latency()` / `stretch_output_latency()`); this is expected and
  fine for our latency budget.
- **Channels**: wrapper handles up to 2 (stereo). Mono input is duplicated.
- This build step runs on **your** machine (Emscripten + network to fetch the
  source). It cannot be produced in the assistant's sandbox.
