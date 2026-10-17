// JNI bridge between Kotlin (expo.modules.repitchaudio.NativeBridge) and the shared header-only C++ cores
// (the same ones iOS uses through the ObjC++ wrappers in ios/RP*.mm):
//   - Signalsmith Stretch      <- RPPitchAudioUnit.mm  (equal frames in/out, pitch only)
//   - TuningEstimator          <- RPTuningDetector.mm
//   - MetronomeCore            <- RPMetronome.mm
//   - PitchDetector (+ history/scope logic) <- RPPitchDetectorBridge.mm
//
// Symbols are exported by name: Java_expo_modules_repitchaudio_NativeBridge_<method>. Method names in
// NativeBridge.kt therefore contain no underscores (those would need "_1" escaping).
//
// Handles are raw pointers carried in a Kotlin Long. Ownership rule: whoever creates a handle destroys it,
// and never while another thread may still be using it (the Kotlin side joins its audio threads first).

#include <jni.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <vector>

#include "signalsmith-stretch.h"

#include "metronome/MetronomeCore.hpp"
#include "tuner/PitchDetector.hpp"
#include "tuning/TuningEstimator.hpp"

#define RP_JNI(ret, name) extern "C" JNIEXPORT ret JNICALL Java_expo_modules_repitchaudio_NativeBridge_##name

namespace {

// ===================================================================================================
// Stretch
// ===================================================================================================

constexpr int kMaxChannels = 8;
constexpr int kStretchChunk = 4096;  // frames per stretch.process() call (iOS' maximumFramesToRender default)

struct StretchCtx {
  signalsmith::stretch::SignalsmithStretch<float> stretch;
  int channels = 0;
  std::vector<float> inPlanar;   // channels * kStretchChunk
  std::vector<float> outPlanar;  // channels * kStretchChunk
  std::vector<float> inter;      // channels * kStretchChunk (interleaved scratch, both directions)
  float semitones = 0.f;
};

// ===================================================================================================
// Metronome
// ===================================================================================================

constexpr int kMetroScratch = 4096;

struct MetroCtx {
  repitch::MetronomeCore core;
  std::vector<float> scratch = std::vector<float>(kMetroScratch, 0.f);
};

// ===================================================================================================
// Tuner (port of RPPitchDetectorBridge.mm: accumulate a history, detect every kHop new samples,
// build the 128-point oscilloscope).
// ===================================================================================================

constexpr int kHop = 1024;           // new samples between two detections
constexpr int kWavePoints = 128;
constexpr int kWaveSpan = 2048;      // samples shown on the scope (each point averages 16)
constexpr float kWaveFloor = 0.05f;  // never amplify noise beyond 20x

struct TunerCtx {
  std::mutex lock;
  std::unique_ptr<repitch::PitchDetector> detector;
  std::vector<float> hist;  // newest samples at the end
  int filled = 0;
  int sinceDetect = 0;
  int seq = 0;
  repitch::PitchResult result;
  float wave[kWavePoints] = {};

  explicit TunerCtx(double sampleRate) {
    detector = std::make_unique<repitch::PitchDetector>(sampleRate);
    const int cap = std::max(detector->windowSize(), kWaveSpan) + kHop * 4;
    hist.assign((size_t)cap, 0.f);
    seq++;
  }

  void reset() {
    std::lock_guard<std::mutex> g(lock);
    filled = 0;
    sinceDetect = 0;
    result = repitch::PitchResult();
    std::memset(wave, 0, sizeof(wave));
    seq++;
  }

  void process(const float* src, int n) {
    if (src == nullptr || n <= 0) return;
    std::lock_guard<std::mutex> g(lock);
    const int cap = (int)hist.size();
    if (n >= cap) {
      std::memcpy(hist.data(), src + (n - cap), (size_t)cap * sizeof(float));
    } else {
      std::memmove(hist.data(), hist.data() + n, (size_t)(cap - n) * sizeof(float));
      std::memcpy(hist.data() + (cap - n), src, (size_t)n * sizeof(float));
    }
    filled = std::min(cap, filled + n);
    sinceDetect += n;

    const int window = detector->windowSize();
    if (filled < window || sinceDetect < kHop) return;
    sinceDetect = 0;
    result = detector->detect(hist.data() + (cap - window), window);

    // Scope: last kWaveSpan samples, decimated by box-averaging (cheap anti-alias), peak-normalised.
    const int step = kWaveSpan / kWavePoints;
    const float* w = hist.data() + (cap - kWaveSpan);
    float peak = 0.f;
    for (int i = 0; i < kWavePoints; i++) {
      float acc = 0.f;
      for (int k = 0; k < step; k++) acc += w[i * step + k];
      wave[i] = acc / (float)step;
      peak = std::max(peak, std::fabs(wave[i]));
    }
    const float scale = 1.f / std::max(peak, kWaveFloor);
    for (int i = 0; i < kWavePoints; i++) wave[i] = std::max(-1.f, std::min(1.f, wave[i] * scale));
    seq++;
  }
};

template <typename T>
T* fromHandle(jlong h) {
  return reinterpret_cast<T*>(static_cast<intptr_t>(h));
}

template <typename T>
jlong toHandle(T* p) {
  return static_cast<jlong>(reinterpret_cast<intptr_t>(p));
}

}  // namespace

// ===================================================================================================
// Stretch JNI
// ===================================================================================================

RP_JNI(jlong, stretchCreate)(JNIEnv*, jobject, jint channels, jint sampleRate) {
  if (channels < 1 || channels > kMaxChannels || sampleRate <= 0) return 0;
  auto* ctx = new StretchCtx();
  ctx->channels = channels;
  ctx->stretch.presetDefault(channels, (float)sampleRate);
  ctx->inPlanar.assign((size_t)channels * kStretchChunk, 0.f);
  ctx->outPlanar.assign((size_t)channels * kStretchChunk, 0.f);
  ctx->inter.assign((size_t)channels * kStretchChunk, 0.f);
  ctx->stretch.setTransposeSemitones(0.f);
  return toHandle(ctx);
}

RP_JNI(void, stretchSetPitch)(JNIEnv*, jobject, jlong handle, jfloat semitones) {
  auto* ctx = fromHandle<StretchCtx>(handle);
  if (ctx == nullptr) return;
  ctx->semitones = semitones;
  ctx->stretch.setTransposeSemitones(semitones);
}

// Interleaved float in -> interleaved float out, EXACTLY `frames` in and `frames` out (rate 1.0, pure pitch
// shift), like RPPitchAudioUnit. The stretcher's own latency is not compensated: the first ~outputLatency
// frames after a reset are (near) silence, same as iOS.
RP_JNI(void, stretchProcess)(JNIEnv* env, jobject, jlong handle, jfloatArray input, jfloatArray output,
                             jint frames) {
  auto* ctx = fromHandle<StretchCtx>(handle);
  if (ctx == nullptr || frames <= 0 || input == nullptr || output == nullptr) return;
  const int ch = ctx->channels;
  // Never read/write past the Java arrays (a Get/SetRegion out of range raises a pending exception and the
  // code after it would still run).
  if (env->GetArrayLength(input) < frames * ch || env->GetArrayLength(output) < frames * ch) return;

  float* inPtrs[kMaxChannels];
  float* outPtrs[kMaxChannels];
  for (int c = 0; c < ch; c++) {
    inPtrs[c] = ctx->inPlanar.data() + (size_t)c * kStretchChunk;
    outPtrs[c] = ctx->outPlanar.data() + (size_t)c * kStretchChunk;
  }

  for (int off = 0; off < frames; off += kStretchChunk) {
    const int n = std::min(kStretchChunk, frames - off);
    env->GetFloatArrayRegion(input, (jsize)(off * ch), (jsize)(n * ch), ctx->inter.data());
    for (int i = 0; i < n; i++)
      for (int c = 0; c < ch; c++) inPtrs[c][i] = ctx->inter[(size_t)i * ch + c];

    ctx->stretch.process(inPtrs, n, outPtrs, n);

    for (int i = 0; i < n; i++)
      for (int c = 0; c < ch; c++) ctx->inter[(size_t)i * ch + c] = outPtrs[c][i];
    env->SetFloatArrayRegion(output, (jsize)(off * ch), (jsize)(n * ch), ctx->inter.data());
  }
}

RP_JNI(void, stretchReset)(JNIEnv*, jobject, jlong handle) {
  auto* ctx = fromHandle<StretchCtx>(handle);
  if (ctx != nullptr) ctx->stretch.reset();
}

RP_JNI(void, stretchDestroy)(JNIEnv*, jobject, jlong handle) {
  delete fromHandle<StretchCtx>(handle);
}

// ===================================================================================================
// Tuning JNI
// ===================================================================================================

// Returns [valid(0/1), refHz, cents, confidence].
RP_JNI(jdoubleArray, tuningEstimate)(JNIEnv* env, jobject, jfloatArray samples, jint count, jfloat sampleRate) {
  if (samples != nullptr) count = std::min<jint>(count, env->GetArrayLength(samples));
  else count = 0;
  std::vector<float> mono((size_t)std::max(0, (int)count));
  if (count > 0) env->GetFloatArrayRegion(samples, 0, count, mono.data());
  const repitch::TuningEstimate est = repitch::estimateTuning(mono.data(), mono.size(), sampleRate);
  const jdouble out[4] = {est.valid ? 1.0 : 0.0, (jdouble)est.refHz, (jdouble)est.cents, (jdouble)est.confidence};
  jdoubleArray arr = env->NewDoubleArray(4);
  if (arr != nullptr) env->SetDoubleArrayRegion(arr, 0, 4, out);
  return arr;
}

// ===================================================================================================
// Metronome JNI
// ===================================================================================================

RP_JNI(jlong, metroCreate)(JNIEnv*, jobject) {
  auto* ctx = new MetroCtx();
  ctx->core.prepare(48000.0);
  return toHandle(ctx);
}

RP_JNI(void, metroPrepare)(JNIEnv*, jobject, jlong handle, jdouble sampleRate) {
  auto* ctx = fromHandle<MetroCtx>(handle);
  if (ctx != nullptr) ctx->core.prepare(sampleRate);  // render must be stopped (Kotlin joins the thread first)
}

RP_JNI(void, metroConfigure)(JNIEnv*, jobject, jlong handle, jdouble bpm, jint beatsPerBar, jdouble volume) {
  auto* ctx = fromHandle<MetroCtx>(handle);
  if (ctx == nullptr) return;
  ctx->core.setBpm(bpm);
  ctx->core.setBeatsPerBar((int)beatsPerBar);
  ctx->core.setVolume((float)volume);
}

RP_JNI(void, metroStart)(JNIEnv*, jobject, jlong handle) {
  auto* ctx = fromHandle<MetroCtx>(handle);
  if (ctx != nullptr) ctx->core.start();
}

RP_JNI(void, metroStop)(JNIEnv*, jobject, jlong handle) {
  auto* ctx = fromHandle<MetroCtx>(handle);
  if (ctx != nullptr) ctx->core.stop();
}

// Renders `frames` mono samples into `out`. Returns false when the block is entirely silent.
RP_JNI(jboolean, metroRender)(JNIEnv* env, jobject, jlong handle, jfloatArray out, jint frames) {
  auto* ctx = fromHandle<MetroCtx>(handle);
  if (ctx == nullptr || frames <= 0 || frames > kMetroScratch || out == nullptr) return JNI_FALSE;
  if (env->GetArrayLength(out) < frames) return JNI_FALSE;
  const bool any = ctx->core.render(ctx->scratch.data(), frames, 0);
  env->SetFloatArrayRegion(out, 0, frames, ctx->scratch.data());
  return any ? JNI_TRUE : JNI_FALSE;
}

// Pops up to out.length beat events. Each long: (frameTime << 8) | (accent ? 0x80 : 0) | (beatIndex & 0x7F),
// where frameTime is the absolute frame (since prepare) at which the click starts.
RP_JNI(jint, metroPopEvents)(JNIEnv* env, jobject, jlong handle, jlongArray out) {
  auto* ctx = fromHandle<MetroCtx>(handle);
  if (ctx == nullptr || out == nullptr) return 0;
  const jsize cap = std::min<jsize>(env->GetArrayLength(out), 64);
  jlong tmp[64];
  jsize n = 0;
  repitch::MetronomeEvent e;
  while (n < cap && ctx->core.popEvent(e)) {
    tmp[n++] = ((jlong)e.frameTime << 8) | (e.accent ? 0x80 : 0) | (jlong)(e.beatIndex & 0x7F);
  }
  if (n > 0) env->SetLongArrayRegion(out, 0, n, tmp);
  return n;
}

RP_JNI(void, metroDestroy)(JNIEnv*, jobject, jlong handle) {
  delete fromHandle<MetroCtx>(handle);
}

// ===================================================================================================
// Tuner JNI
// ===================================================================================================

RP_JNI(jlong, tunerCreate)(JNIEnv*, jobject, jdouble sampleRate) {
  return toHandle(new TunerCtx(sampleRate));
}

RP_JNI(void, tunerProcess)(JNIEnv* env, jobject, jlong handle, jfloatArray samples, jint count) {
  auto* ctx = fromHandle<TunerCtx>(handle);
  if (ctx == nullptr || count <= 0 || samples == nullptr) return;
  // The reader thread uses fixed blocks (<= 4096 frames); a stack buffer avoids per-call allocation.
  float buf[4096];
  const int n = std::min<int>({count, 4096, (int)env->GetArrayLength(samples)});
  if (n <= 0) return;
  env->GetFloatArrayRegion(samples, 0, n, buf);
  ctx->process(buf, n);
}

// out (length >= 3 + kWavePoints = 131): [frequency, clarity, rms, wave[0..127]]. Returns the sequence number
// (changes at every new detection).
RP_JNI(jint, tunerReading)(JNIEnv* env, jobject, jlong handle, jfloatArray out) {
  auto* ctx = fromHandle<TunerCtx>(handle);
  if (ctx == nullptr || out == nullptr || env->GetArrayLength(out) < 3 + kWavePoints) return -1;
  float tmp[3 + kWavePoints];
  int seq;
  {
    std::lock_guard<std::mutex> g(ctx->lock);
    tmp[0] = ctx->result.frequency;
    tmp[1] = ctx->result.clarity;
    tmp[2] = ctx->result.rms;
    std::memcpy(tmp + 3, ctx->wave, sizeof(ctx->wave));
    seq = ctx->seq;
  }
  env->SetFloatArrayRegion(out, 0, 3 + kWavePoints, tmp);
  return seq;
}

RP_JNI(void, tunerReset)(JNIEnv*, jobject, jlong handle) {
  auto* ctx = fromHandle<TunerCtx>(handle);
  if (ctx != nullptr) ctx->reset();
}

RP_JNI(void, tunerDestroy)(JNIEnv*, jobject, jlong handle) {
  delete fromHandle<TunerCtx>(handle);
}
