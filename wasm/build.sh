#!/usr/bin/env bash
#
# Builds the Signalsmith Stretch WASM pitch-shifter and assembles the
# AudioWorklet served by the app at public/signalsmith-worklet.js.
#
# Prerequisites:
#   - Emscripten SDK (emcc) on PATH.  Install once:
#       git clone https://github.com/emscripten-core/emsdk.git
#       cd emsdk && ./emsdk install latest && ./emsdk activate latest
#       source ./emsdk_env.sh        # adds emcc to PATH (do this each shell)
#   - git (to fetch the Signalsmith source, MIT-licensed).
#
# Run from this directory:  ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

STRETCH_DIR="signalsmith-stretch"
LINEAR_DIR="signalsmith-linear"

# 1) Fetch Signalsmith Stretch (+ submodules) if not present.
if [ ! -d "$STRETCH_DIR" ]; then
  echo "==> Cloning Signalsmith Stretch…"
  git clone --recursive https://github.com/Signalsmith-Audio/signalsmith-stretch.git "$STRETCH_DIR"
fi

# 1b) Fetch the "linear" dependency (signalsmith-stretch.h includes
#     "signalsmith-linear/stft.h"). Cloned into a folder of that exact name so
#     the quote-include resolves via the -I . path below.
if [ ! -d "$LINEAR_DIR" ]; then
  echo "==> Cloning Signalsmith Linear…"
  git clone --recursive https://github.com/Signalsmith-Audio/linear.git "$LINEAR_DIR"
fi

if ! command -v emcc >/dev/null 2>&1; then
  echo "ERROR: emcc not found. Install Emscripten and 'source emsdk_env.sh' first." >&2
  exit 1
fi

# 2) Compile the C wrapper to a single-file, worker-friendly WASM module.
echo "==> Compiling WASM…"
emcc stretch_wrapper.cpp \
  -I "$STRETCH_DIR" \
  -I . \
  -O3 -std=c++17 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createStretchModule \
  -s ENVIRONMENT=worker \
  -s SINGLE_FILE=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_stretch_create","_stretch_set_transpose","_stretch_reset","_stretch_input_latency","_stretch_output_latency","_stretch_process2"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o stretch-module.js

# 3) Assemble the worklet. AudioWorkletGlobalScope lacks several globals the
#    Emscripten glue may touch (self/window/location), so shim them first, then
#    the glue, then our processor.
echo "==> Assembling public/signalsmith-worklet.js…"
{
  printf 'var globalScope=globalThis;globalScope.self=globalScope;globalScope.window=globalScope;globalScope.location=globalScope.location||{href:""};if(typeof globalScope.crypto==="undefined"||!globalScope.crypto.getRandomValues){try{globalScope.crypto={getRandomValues:function(v){for(var i=0;i<v.length;i++)v[i]=(Math.random()*256)|0;return v;}};}catch(e){}}\n'
  cat stretch-module.js stretch-processor.js
} > ../public/signalsmith-worklet.js

echo "==> Done. Built public/signalsmith-worklet.js"
echo "    (If the include path fails, try also: -I $STRETCH_DIR/dsp)"
