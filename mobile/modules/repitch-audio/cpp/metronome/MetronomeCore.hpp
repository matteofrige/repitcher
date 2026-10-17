// MetronomeCore.hpp — click del metronomo sample-accurate, header-only, senza dipendenze.
//
// Porting del worklet desktop (public/metronome-worklet.js) pensato per girare nel
// render thread audio: nessuna allocazione, nessun lock. Il timing dipende solo dal
// conteggio dei frame (accumulatore double, zero deriva), mai da timer del main thread.
// I parametri passano dal thread UI al render thread tramite atomici; ogni battito
// suonato viene scritto in una coda lock-free SPSC letta dal thread UI.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace repitch {

struct MetronomeEvent {
  int32_t beatIndex = 0;     // posizione nella misura (0 = primo battito)
  bool accent = false;
  int64_t frameTime = 0;     // frame assoluto (dal prepare) in cui parte il click
  uint64_t blockTag = 0;     // tag opaco del blocco di render (il bridge ci mette l'hostTime)
  int32_t frameInBlock = 0;  // offset del click dentro quel blocco
};

/// Coda SPSC lock-free a capacità fissa (potenza di 2). Un produttore, un consumatore.
template <typename T, size_t N>
class SpscQueue {
  static_assert((N & (N - 1)) == 0, "N deve essere una potenza di 2");

 public:
  bool push(const T& v) {
    const size_t w = write_.load(std::memory_order_relaxed);
    if (w - read_.load(std::memory_order_acquire) == N) return false;  // piena
    buf_[w & (N - 1)] = v;
    write_.store(w + 1, std::memory_order_release);
    return true;
  }
  bool pop(T& out) {
    const size_t r = read_.load(std::memory_order_relaxed);
    if (r == write_.load(std::memory_order_acquire)) return false;  // vuota
    out = buf_[r & (N - 1)];
    read_.store(r + 1, std::memory_order_release);
    return true;
  }

 private:
  T buf_[N];
  std::atomic<size_t> write_{0};
  std::atomic<size_t> read_{0};
};

class MetronomeCore {
 public:
  static constexpr double kMinBpm = 20, kMaxBpm = 300;
  static constexpr int kMinBeats = 1, kMaxBeats = 12;

  /// Da chiamare con il render fermo (o prima del primo render). Azzera il tempo assoluto.
  void prepare(double sampleRate) {
    sr_ = sampleRate > 0 ? sampleRate : 48000.0;
    attackSamples_ = std::max(1, (int)std::lround(0.001 * sr_));            // 1 ms
    decayTau_ = 0.018 * sr_;                                                // tau 18 ms
    decayCoef_ = std::exp(-1.0 / decayTau_);
    clickLength_ = (int)std::lround(0.07 * sr_);                            // 70 ms
    noiseSamples_ = std::max(1, (int)std::lround(0.0015 * sr_));            // transiente di rumore 1,5 ms
    frame_ = 0;
    clickPos_ = -1;
    active_ = false;
    seenStartSeq_ = startSeq_.load(std::memory_order_acquire) - 1;  // se running: riparte da capo
    appliedBpm_ = bpm_.load(std::memory_order_relaxed);
    samplesPerBeat_ = sr_ * 60.0 / appliedBpm_;
    MetronomeEvent e;
    while (events_.pop(e)) {}
  }

  // --- Thread UI ---
  void setBpm(double bpm) { bpm_.store(clampd(bpm, kMinBpm, kMaxBpm), std::memory_order_relaxed); }
  void setBeatsPerBar(int n) { beatsPerBar_.store(std::min(std::max(n, kMinBeats), kMaxBeats), std::memory_order_relaxed); }
  void setVolume(float v) { volume_.store(clampd(v, 0.0, 1.0), std::memory_order_relaxed); }
  void start() {
    startSeq_.fetch_add(1, std::memory_order_acq_rel);
    running_.store(true, std::memory_order_release);
  }
  void stop() { running_.store(false, std::memory_order_release); }
  bool isRunning() const { return running_.load(std::memory_order_acquire); }
  bool popEvent(MetronomeEvent& e) { return events_.pop(e); }
  double sampleRate() const { return sr_; }

  /// Render thread. Scrive `frames` campioni mono; ritorna false se il blocco è tutto silenzio.
  /// `blockTag` viene copiato negli eventi di questo blocco.
  bool render(float* out, int frames, uint64_t blockTag = 0) {
    const bool wantRun = running_.load(std::memory_order_acquire);
    const uint32_t seq = startSeq_.load(std::memory_order_acquire);
    if (wantRun && (!active_ || seq != seenStartSeq_)) {
      // (Ri)partenza: primo click immediato, battito 0.
      seenStartSeq_ = seq;
      active_ = true;
      beat_ = 0;
      nextBeatFrame_ = (double)frame_;
      appliedBpm_ = bpm_.load(std::memory_order_relaxed);
      samplesPerBeat_ = sr_ * 60.0 / appliedBpm_;
      clickPos_ = -1;
    } else if (!wantRun && active_) {
      active_ = false;
      clickPos_ = -1;  // silenzio immediato
    }

    if (active_) {
      // Cambio di BPM in corsa: ricalcola dall'ultimo battito suonato, senza saltarne.
      const double bpm = bpm_.load(std::memory_order_relaxed);
      if (bpm != appliedBpm_) {
        const double oldSpb = samplesPerBeat_;
        appliedBpm_ = bpm;
        samplesPerBeat_ = sr_ * 60.0 / bpm;
        const double lastBeatFrame = nextBeatFrame_ - oldSpb;
        nextBeatFrame_ = std::max((double)frame_, lastBeatFrame + samplesPerBeat_);
      }
      const int bpb = beatsPerBar_.load(std::memory_order_relaxed);
      if (beat_ >= bpb) beat_ = 0;
    }
    const int bpb = beatsPerBar_.load(std::memory_order_relaxed);
    const float vol = volume_.load(std::memory_order_relaxed);

    bool any = false;
    for (int i = 0; i < frames; ++i) {
      // Confronto per singolo frame: il click parte con precisione di sub-blocco.
      if (active_ && (double)frame_ >= nextBeatFrame_) {
        const bool accent = beat_ == 0;
        startClick(accent);
        MetronomeEvent e;
        e.beatIndex = beat_;
        e.accent = accent;
        e.frameTime = frame_;
        e.blockTag = blockTag;
        e.frameInBlock = i;
        events_.push(e);  // se piena (UI bloccata) l'evento si perde, il suono no
        nextBeatFrame_ += samplesPerBeat_;
        beat_ = (beat_ + 1) % bpb;
      }
      float s = 0.f;
      if (clickPos_ >= 0) {
        // Soft limiter: a volumi bassi quasi lineare, al 100% il click satura dolcemente (picco < 1).
        s = std::tanh(nextClickSample() * vol * 2.5f) * level_;  // limiter morbido, poi accento più forte
        any = any || s != 0.f;
      }
      out[i] = s;
      ++frame_;
    }
    return any;
  }

 private:
  static double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

  void startClick(bool accent) {
    const double freq = accent ? 2000.0 : 1400.0;
    clickAmp_ = accent ? 1.0 : 0.75;
    level_ = accent ? 1.f : 0.7f;  // dopo il limiter: il primo battito resta distinguibile anche a volume pieno
    phase_ = 0.0;                                   // fasi azzerate: tono identico a ogni colpo
    phase2_ = 0.0;
    phaseInc_ = 2.0 * M_PI * freq / sr_;
    phaseInc2_ = 2.0 * phaseInc_;                   // 2ª parziale a 2× la fondamentale
    noiseState_ = 0x9E3779B9u;                      // seme fisso: anche il transiente è identico a ogni colpo
    clickPos_ = 0;
    env_ = clickAmp_;
  }

  // Attacco lineare 0→amp in 1 ms, poi decadimento esponenziale (ricorsivo: env *= e^(-1/tau)).
  // Timbro: fondamentale + 2ª parziale (0,35) + breve transiente di rumore (LCG, 0,5·amp → 0 lineare).
  float nextClickSample() {
    if (clickPos_ >= clickLength_) { clickPos_ = -1; return 0.f; }
    double envelope;
    if (clickPos_ < attackSamples_) {
      envelope = clickAmp_ * ((double)clickPos_ / attackSamples_);
    } else {
      if (clickPos_ > attackSamples_) env_ *= decayCoef_;
      envelope = env_;
    }
    double s = (std::sin(phase_) + 0.35 * std::sin(phase2_)) * envelope;
    if (clickPos_ > 0 && clickPos_ < noiseSamples_) {  // dal 2º campione: il click parte da 0, senza scalino
      noiseState_ = noiseState_ * 1664525u + 1013904223u;
      const double n = (double)(int32_t)noiseState_ / 2147483648.0;  // [-1, 1)
      s += n * 0.5 * clickAmp_ * (1.0 - (double)clickPos_ / noiseSamples_);
    }
    phase_ += phaseInc_;
    phase2_ += phaseInc2_;
    ++clickPos_;
    return (float)s;
  }

  // Parametri condivisi UI → render
  std::atomic<double> bpm_{100.0};
  std::atomic<int> beatsPerBar_{4};
  std::atomic<float> volume_{0.8f};
  std::atomic<bool> running_{false};
  std::atomic<uint32_t> startSeq_{0};
  SpscQueue<MetronomeEvent, 128> events_;

  // Stato del solo render thread
  double sr_ = 48000.0;
  int attackSamples_ = 48;
  double decayTau_ = 864.0, decayCoef_ = 0.998;
  int clickLength_ = 3360;
  int noiseSamples_ = 72;
  uint32_t noiseState_ = 0x9E3779B9u;
  int64_t frame_ = 0;
  double nextBeatFrame_ = 0.0;
  double samplesPerBeat_ = 24000.0;
  double appliedBpm_ = 100.0;
  int beat_ = 0;
  bool active_ = false;
  uint32_t seenStartSeq_ = 0;
  int clickPos_ = -1;
  float level_ = 1.f;
  double clickAmp_ = 0, phase_ = 0, phase2_ = 0, phaseInc_ = 0, phaseInc2_ = 0, env_ = 0;
};

}  // namespace repitch
