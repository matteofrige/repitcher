// JNI for beat detection + beat follow (Android counterpart of ios/RPBeatDetector.mm and the follow part of
// RPMetronome.mm). Same shared cores as iOS: BeatThisFrontend / BeatThisChunking / BeatTracker / MetronomeCore.
//
// Handle lifetimes are explicit (create/destroy); whoever creates a handle destroys it.
//   Frontend  -> beatFrontendFinish() hands out a Net (spectrogram + chunk layout, network I/O staging)
//   Net       -> beatNetStitch() hands out an Act (beat/down activations, 50 fps)
//   Act       -> analyze / downbeatPhase / (de)serialise for the on-disk cache
// Result arrays are packed doubles: [valid, uncertain, bpm, confidence, downbeatIndex, downbeatMargin, beats...].

#include <jni.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <vector>

#include "beats/BeatThisFrontend.hpp"
#include "beats/BeatTracker.hpp"
#include "metronome/MetronomeCore.hpp"

#define RP_JNI(ret, name) extern "C" JNIEXPORT ret JNICALL Java_expo_modules_repitchaudio_NativeBridge_##name

using repitch::BeatThisChunking;
using repitch::BeatThisFrontend;

namespace {

template <typename T>
T* fromHandle(jlong h) {
  return reinterpret_cast<T*>(static_cast<intptr_t>(h));
}
template <typename T>
jlong toHandle(T* p) {
  return static_cast<jlong>(reinterpret_cast<intptr_t>(p));
}

constexpr double kNeuralFps = (double)BeatThisFrontend::kSampleRate / (double)BeatThisFrontend::kHop;  // 50

struct FrontendCtx {
  BeatThisFrontend fe;
  bool started = false;
};

struct NetCtx {
  std::vector<float> spec;  // frames x 128
  long long frames = 0;
  std::vector<BeatThisChunking::Chunk> chunks;
  std::vector<std::vector<float>> beatOuts, downOuts;
};

struct ActCtx {
  std::vector<float> beat, down;
  double fps = kNeuralFps;
};

struct SpectralCtx {
  repitch::BeatTracker tracker;
  bool started = false;
};

jdoubleArray pack(JNIEnv* env, const repitch::BeatTrackerResult& r, int phase, float margin) {
  std::vector<jdouble> out;
  out.reserve(6 + r.beats.size());
  out.push_back(r.valid ? 1.0 : 0.0);
  out.push_back(r.uncertain ? 1.0 : 0.0);
  out.push_back(r.medianBpm);
  out.push_back((double)r.confidence);
  out.push_back((double)phase);
  out.push_back((double)margin);
  for (double t : r.beats) out.push_back(t);
  jdoubleArray arr = env->NewDoubleArray((jsize)out.size());
  if (arr != nullptr) env->SetDoubleArrayRegion(arr, 0, (jsize)out.size(), out.data());
  return arr;
}

std::vector<double> toVec(JNIEnv* env, jdoubleArray a) {
  std::vector<double> v;
  if (a == nullptr) return v;
  const jsize n = env->GetArrayLength(a);
  v.resize((size_t)n);
  if (n > 0) env->GetDoubleArrayRegion(a, 0, n, v.data());
  return v;
}

// ---- Beat follow mixer -------------------------------------------------------------------------------------
// Owned by the audio (playback) thread, except setBeats/configure which come from the main thread:
//  - beats are swapped under a mutex that the audio thread only try_locks (never blocks, never allocates);
//  - options are atomics.
// Core time == number of output frames mixed since prepare (the core is rendered for EVERY block).
struct FollowCtx {
  repitch::MetronomeCore core;
  std::mutex mu;
  std::vector<double> beats;  // guarded by mu
  std::atomic<uint32_t> beatsGen{0};
  std::atomic<bool> on{false};
  std::atomic<int> bpb{4}, downbeat{0};
  std::atomic<bool> resync{false};

  // audio thread only
  std::vector<float> mono = std::vector<float>(4096, 0.f);
  double sr = 48000.0;
  int64_t coreFrame = 0;
  bool segActive = false;
  double segPts = 0.0;
  int64_t segBase = 0;
  int latency = 0;
  size_t next = 0;
  uint32_t seenGen = 0;
};

constexpr double kLateTolerance = 0.02;

size_t firstBeat(const std::vector<double>& b, double t) {
  return (size_t)(std::lower_bound(b.begin(), b.end(), t) - b.begin());
}

}  // namespace

// ===================================================================================================
// Neural path
// ===================================================================================================

RP_JNI(jlong, beatFrontendCreate)(JNIEnv*, jobject) { return toHandle(new FrontendCtx()); }

RP_JNI(jboolean, beatFrontendBegin)(JNIEnv*, jobject, jlong h, jdouble sampleRate) {
  auto* c = fromHandle<FrontendCtx>(h);
  if (c == nullptr) return JNI_FALSE;
  c->started = c->fe.begin(sampleRate);
  return c->started ? JNI_TRUE : JNI_FALSE;
}

RP_JNI(void, beatFrontendPush)(JNIEnv* env, jobject, jlong h, jfloatArray samples, jint count) {
  auto* c = fromHandle<FrontendCtx>(h);
  if (c == nullptr || !c->started || samples == nullptr || count <= 0) return;
  count = std::min<jint>(count, env->GetArrayLength(samples));
  jfloat* p = env->GetFloatArrayElements(samples, nullptr);
  if (p == nullptr) return;
  c->fe.push(p, (size_t)count);
  env->ReleaseFloatArrayElements(samples, p, JNI_ABORT);
}

// Returns a Net handle, or 0 when the file is too short (< 100 frames, like iOS) or the frontend never started.
RP_JNI(jlong, beatFrontendFinish)(JNIEnv*, jobject, jlong h) {
  auto* c = fromHandle<FrontendCtx>(h);
  if (c == nullptr || !c->started) return 0;
  auto* net = new NetCtx();
  net->spec = c->fe.finish();
  c->started = false;
  net->frames = (long long)(net->spec.size() / BeatThisFrontend::kMels);
  if (net->frames < 100) {
    delete net;
    return 0;
  }
  net->chunks = BeatThisChunking::split(net->frames);
  net->beatOuts.resize(net->chunks.size());
  net->downOuts.resize(net->chunks.size());
  return toHandle(net);
}

RP_JNI(void, beatFrontendDestroy)(JNIEnv*, jobject, jlong h) { delete fromHandle<FrontendCtx>(h); }

RP_JNI(jint, beatNetChunkCount)(JNIEnv*, jobject, jlong h) {
  auto* n = fromHandle<NetCtx>(h);
  return n ? (jint)n->chunks.size() : 0;
}

RP_JNI(jint, beatNetFrames)(JNIEnv*, jobject, jlong h) {
  auto* n = fromHandle<NetCtx>(h);
  return n ? (jint)n->frames : 0;
}

// Fills `dst` (a DIRECT buffer of >= 1500*128 floats) with chunk `idx` (beat_this padding, rest zero).
RP_JNI(jint, beatNetFill)(JNIEnv* env, jobject, jlong h, jint idx, jobject dst) {
  auto* n = fromHandle<NetCtx>(h);
  if (n == nullptr || idx < 0 || (size_t)idx >= n->chunks.size() || dst == nullptr) return -1;
  const int bins = BeatThisFrontend::kMels;
  const size_t need = (size_t)BeatThisChunking::kChunk * bins;
  if ((size_t)env->GetDirectBufferCapacity(dst) < need * sizeof(float)) return -1;
  auto* p = static_cast<float*>(env->GetDirectBufferAddress(dst));
  if (p == nullptr) return -1;
  std::fill(p, p + need, 0.f);
  BeatThisChunking::fill(n->chunks[(size_t)idx], n->spec.data(), bins, p);
  return (jint)n->chunks[(size_t)idx].length();
}

// Stores the network output of chunk `idx` (first c.length() values of each, like iOS' copyOut).
RP_JNI(jboolean, beatNetSetOutput)(JNIEnv* env, jobject, jlong h, jint idx, jfloatArray beat, jfloatArray down) {
  auto* n = fromHandle<NetCtx>(h);
  if (n == nullptr || idx < 0 || (size_t)idx >= n->chunks.size() || beat == nullptr || down == nullptr) return JNI_FALSE;
  const jsize len = (jsize)n->chunks[(size_t)idx].length();
  if (env->GetArrayLength(beat) < len || env->GetArrayLength(down) < len) return JNI_FALSE;
  n->beatOuts[(size_t)idx].resize((size_t)len);
  n->downOuts[(size_t)idx].resize((size_t)len);
  env->GetFloatArrayRegion(beat, 0, len, n->beatOuts[(size_t)idx].data());
  env->GetFloatArrayRegion(down, 0, len, n->downOuts[(size_t)idx].data());
  return JNI_TRUE;
}

// Stitches the chunk outputs into an Act. Frames never covered stay -1000 in the stitch: clamped to 0 here.
RP_JNI(jlong, beatNetStitch)(JNIEnv*, jobject, jlong h) {
  auto* n = fromHandle<NetCtx>(h);
  if (n == nullptr) return 0;
  auto* a = new ActCtx();
  a->beat = BeatThisChunking::stitch(n->chunks, n->beatOuts, n->frames);
  a->down = BeatThisChunking::stitch(n->chunks, n->downOuts, n->frames);
  for (auto& v : a->beat) if (!(v >= 0.f)) v = 0.f;
  for (auto& v : a->down) if (!(v >= 0.f)) v = 0.f;
  a->fps = kNeuralFps;
  return toHandle(a);
}

RP_JNI(void, beatNetDestroy)(JNIEnv*, jobject, jlong h) { delete fromHandle<NetCtx>(h); }

// ---- Activation ----

// data = beat[frames] followed by down[frames].
RP_JNI(jlong, beatActCreate)(JNIEnv* env, jobject, jfloatArray data, jint frames, jfloat fps) {
  if (data == nullptr || frames <= 0 || env->GetArrayLength(data) < 2 * frames) return 0;
  auto* a = new ActCtx();
  a->beat.resize((size_t)frames);
  a->down.resize((size_t)frames);
  env->GetFloatArrayRegion(data, 0, frames, a->beat.data());
  env->GetFloatArrayRegion(data, frames, frames, a->down.data());
  a->fps = fps;
  return toHandle(a);
}

RP_JNI(jfloatArray, beatActData)(JNIEnv* env, jobject, jlong h) {
  auto* a = fromHandle<ActCtx>(h);
  if (a == nullptr) return nullptr;
  const jsize n = (jsize)a->beat.size();
  jfloatArray arr = env->NewFloatArray(2 * n);
  if (arr == nullptr) return nullptr;
  env->SetFloatArrayRegion(arr, 0, n, a->beat.data());
  env->SetFloatArrayRegion(arr, n, n, a->down.data());
  return arr;
}

RP_JNI(jint, beatActFrames)(JNIEnv*, jobject, jlong h) {
  auto* a = fromHandle<ActCtx>(h);
  return a ? (jint)a->beat.size() : 0;
}

RP_JNI(jfloat, beatActFps)(JNIEnv*, jobject, jlong h) {
  auto* a = fromHandle<ActCtx>(h);
  return a ? (jfloat)a->fps : 0.f;
}

// Same as DetectNeural's tail on iOS: analyzeActivation with anchors, then the downbeat phase of the result.
RP_JNI(jdoubleArray, beatActAnalyze)(JNIEnv* env, jobject, jlong h, jdoubleArray anchors, jint beatsPerBar) {
  auto* a = fromHandle<ActCtx>(h);
  if (a == nullptr) return nullptr;
  repitch::BeatTracker tracker;
  tracker.setAnchors(toVec(env, anchors));
  const repitch::BeatTrackerResult res = tracker.analyzeActivation(a->beat.data(), a->beat.size(), a->fps, a->down.data());
  float margin = 0.f;
  const int phase = repitch::BeatTracker::downbeatPhase(res.beats, a->down.data(), a->down.size(), a->fps,
                                                         std::max<int>(beatsPerBar, 2), &margin);
  return pack(env, res, phase, margin);
}

// Returns [index, margin].
RP_JNI(jdoubleArray, beatActDownbeatPhase)(JNIEnv* env, jobject, jlong h, jdoubleArray beats, jint beatsPerBar) {
  auto* a = fromHandle<ActCtx>(h);
  if (a == nullptr) return nullptr;
  const std::vector<double> b = toVec(env, beats);
  float margin = 0.f;
  const int phase = repitch::BeatTracker::downbeatPhase(b, a->down.data(), a->down.size(), a->fps,
                                                         std::max<int>(beatsPerBar, 2), &margin);
  const jdouble out[2] = {(jdouble)phase, (jdouble)margin};
  jdoubleArray arr = env->NewDoubleArray(2);
  if (arr != nullptr) env->SetDoubleArrayRegion(arr, 0, 2, out);
  return arr;
}

RP_JNI(void, beatActDestroy)(JNIEnv*, jobject, jlong h) { delete fromHandle<ActCtx>(h); }

// ===================================================================================================
// Spectral fallback
// ===================================================================================================

RP_JNI(jlong, beatSpectralCreate)(JNIEnv* env, jobject, jdoubleArray anchors) {
  auto* c = new SpectralCtx();
  c->tracker.setAnchors(toVec(env, anchors));
  return toHandle(c);
}

RP_JNI(void, beatSpectralBegin)(JNIEnv*, jobject, jlong h, jdouble sampleRate) {
  auto* c = fromHandle<SpectralCtx>(h);
  if (c == nullptr) return;
  c->tracker.begin(sampleRate);
  c->started = true;
}

RP_JNI(void, beatSpectralPush)(JNIEnv* env, jobject, jlong h, jfloatArray samples, jint count) {
  auto* c = fromHandle<SpectralCtx>(h);
  if (c == nullptr || !c->started || samples == nullptr || count <= 0) return;
  count = std::min<jint>(count, env->GetArrayLength(samples));
  jfloat* p = env->GetFloatArrayElements(samples, nullptr);
  if (p == nullptr) return;
  c->tracker.push(p, (size_t)count);
  env->ReleaseFloatArrayElements(samples, p, JNI_ABORT);
}

RP_JNI(jdoubleArray, beatSpectralFinish)(JNIEnv* env, jobject, jlong h) {
  auto* c = fromHandle<SpectralCtx>(h);
  if (c == nullptr) return nullptr;
  return pack(env, c->tracker.finish(), 0, 0.f);
}

RP_JNI(void, beatSpectralDestroy)(JNIEnv*, jobject, jlong h) { delete fromHandle<SpectralCtx>(h); }

// ===================================================================================================
// Beat follow mixer (clicks mixed after the pitch shifter, sample-accurate)
// ===================================================================================================

RP_JNI(jlong, followCreate)(JNIEnv*, jobject) {
  auto* f = new FollowCtx();
  f->core.prepare(48000.0);
  f->core.setFollow(false);
  return toHandle(f);
}

RP_JNI(void, followDestroy)(JNIEnv*, jobject, jlong h) { delete fromHandle<FollowCtx>(h); }

// Audio thread (or before it runs): resets core time and the segment.
RP_JNI(void, followPrepare)(JNIEnv*, jobject, jlong h, jdouble sampleRate) {
  auto* f = fromHandle<FollowCtx>(h);
  if (f == nullptr) return;
  f->sr = sampleRate > 0 ? sampleRate : 48000.0;
  f->core.prepare(f->sr);
  f->coreFrame = 0;
  f->segActive = false;
  f->next = 0;
  f->resync.store(true, std::memory_order_release);
}

// Main thread. `beats` ascending seconds in the file.
RP_JNI(void, followSetBeats)(JNIEnv* env, jobject, jlong h, jdoubleArray beats) {
  auto* f = fromHandle<FollowCtx>(h);
  if (f == nullptr) return;
  std::vector<double> v = toVec(env, beats);  // allocated outside the lock
  {
    std::lock_guard<std::mutex> g(f->mu);
    f->beats.swap(v);
  }
  f->beatsGen.fetch_add(1, std::memory_order_acq_rel);
}

// Main thread. Atomics only.
RP_JNI(void, followConfigure)(JNIEnv*, jobject, jlong h, jboolean on, jboolean audible, jint beatsPerBar,
                              jint downbeat, jdouble volume) {
  auto* f = fromHandle<FollowCtx>(h);
  if (f == nullptr) return;
  f->bpb.store(std::max(1, (int)beatsPerBar), std::memory_order_relaxed);
  f->downbeat.store(std::max(0, (int)downbeat), std::memory_order_relaxed);
  f->core.setVolume((float)volume);
  f->core.setFollowClickAudible(audible == JNI_TRUE);
  f->core.setFollow(on == JNI_TRUE);
  const bool was = f->on.exchange(on == JNI_TRUE, std::memory_order_acq_rel);
  if (was != (on == JNI_TRUE)) f->resync.store(true, std::memory_order_release);
}

// Playback thread: a new stream segment starts (first buffer after a flush). `pts` = file time (s) of its first
// input frame, `latencyFrames` = the stretcher's input+output latency.
RP_JNI(void, followSegment)(JNIEnv*, jobject, jlong h, jdouble pts, jint latencyFrames) {
  auto* f = fromHandle<FollowCtx>(h);
  if (f == nullptr) return;
  f->segActive = true;
  f->segPts = pts;
  f->segBase = f->coreFrame;
  f->latency = latencyFrames;
  f->core.clearScheduled();
  f->resync.store(true, std::memory_order_release);
}

// Playback thread: adds the clicks for the next `frames` output frames to `inter` (interleaved, `channels`).
RP_JNI(void, followMix)(JNIEnv* env, jobject, jlong h, jfloatArray inter, jint frames, jint channels) {
  auto* f = fromHandle<FollowCtx>(h);
  if (f == nullptr || frames <= 0 || frames > 4096 || channels < 1 || inter == nullptr) return;
  const int64_t blockStart = f->coreFrame;
  const int64_t blockEnd = blockStart + frames;

  if (f->on.load(std::memory_order_acquire) && f->segActive) {
    std::unique_lock<std::mutex> lk(f->mu, std::try_to_lock);
    if (lk.owns_lock()) {
      const uint32_t gen = f->beatsGen.load(std::memory_order_acquire);
      if (f->resync.exchange(false, std::memory_order_acq_rel) || gen != f->seenGen) {
        f->seenGen = gen;
        f->core.clearScheduled();
        const double heard = f->segPts + (double)(blockStart - f->segBase - f->latency) / f->sr;
        f->next = firstBeat(f->beats, heard - kLateTolerance);
      }
      const int bpb = f->bpb.load(std::memory_order_relaxed);
      const int down = f->downbeat.load(std::memory_order_relaxed);
      while (f->next < f->beats.size()) {
        const int64_t of = f->segBase + (int64_t)std::llround((f->beats[f->next] - f->segPts) * f->sr) + f->latency;
        if (of >= blockEnd + 2048) break;  // keep the queue short; retried next block
        if (of >= blockStart - frames) {
          const int i = (int)f->next;
          const int inBar = (((i - down) % bpb) + bpb) % bpb;
          if (!f->core.scheduleClick(of, inBar == 0, inBar)) break;
        }
        f->next++;
      }
    }
  }

  const bool any = f->core.render(f->mono.data(), frames, 0);
  f->coreFrame = blockEnd;
  repitch::MetronomeEvent e;
  while (f->core.popEvent(e)) {}  // unused: the Kotlin pump reports beats ahead of time
  if (!any) return;
  const jsize len = env->GetArrayLength(inter);
  if (len < frames * channels) return;
  auto* p = static_cast<float*>(env->GetPrimitiveArrayCritical(inter, nullptr));
  if (p == nullptr) return;
  for (int i = 0; i < frames; i++) {
    const float s = f->mono[(size_t)i];
    for (int c = 0; c < channels; c++) p[(size_t)i * channels + c] += s;
  }
  env->ReleasePrimitiveArrayCritical(inter, p, 0);
}
