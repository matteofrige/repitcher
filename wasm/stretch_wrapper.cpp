// C wrapper around Signalsmith Stretch for use from an AudioWorklet via WASM.
//
// Exposes a tiny extern "C" surface so the JS side can drive a single stereo
// (<= 2 channel) real-time pitch-shifter. Pure pitch shift = equal input/output
// sample counts (rate 1.0); only the transpose changes.
//
// Build: see wasm/build.sh. Signalsmith Stretch is MIT-licensed.

#include "signalsmith-stretch.h"

using Stretch = signalsmith::stretch::SignalsmithStretch<float>;

namespace {
Stretch *g_stretch = nullptr;
int g_channels = 2;
}

extern "C" {

// Create (or recreate) the stretcher for the given channel count / sample rate.
void stretch_create(int channels, float sampleRate) {
  if (g_stretch) {
    delete g_stretch;
    g_stretch = nullptr;
  }
  g_channels = channels < 1 ? 1 : (channels > 2 ? 2 : channels);
  g_stretch = new Stretch();
  g_stretch->presetDefault(g_channels, sampleRate);
}

void stretch_set_transpose(float semitones) {
  if (g_stretch) g_stretch->setTransposeSemitones(semitones);
}

void stretch_reset() {
  if (g_stretch) g_stretch->reset();
}

int stretch_input_latency() {
  return g_stretch ? g_stretch->inputLatency() : 0;
}

int stretch_output_latency() {
  return g_stretch ? g_stretch->outputLatency() : 0;
}

// Process up to 2 planar channel buffers. For pure pitch shift call with
// inSamples == outSamples. Unused channel pointers may be null.
void stretch_process2(float *in0, float *in1, int inSamples,
                      float *out0, float *out1, int outSamples) {
  if (!g_stretch) return;
  float *inPtrs[2] = {in0, in1 ? in1 : in0};
  float *outPtrs[2] = {out0, out1 ? out1 : out0};
  g_stretch->process(inPtrs, inSamples, outPtrs, outSamples);
}

} // extern "C"
