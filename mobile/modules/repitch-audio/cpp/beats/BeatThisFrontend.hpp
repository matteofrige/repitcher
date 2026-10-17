// Preprocessing di Beat This! (CPJKU, licenza MIT) in C++: porta fedele di
// beat_this/preprocessing.py (LogMelSpect) + beat_this/inference.py (chunking).
// Header-only, C++17, solo STL (+ la FFT reale di BeatTracker.hpp). Nessuno stato globale.
//
// Catena (parametri verificati sul sorgente di beat_this 1.x e torchaudio):
//  1. mono -> 22050 Hz (beat_this usa soxr; qui: sinc con finestra di Kaiser, polifase, rapporto
//     qualsiasi, in streaming);
//  2. STFT n_fft 1024, win_length 1024, hop 441, finestra Hann PERIODICA (torch.hann_window),
//     center=True con pad_mode "reflect" (512 campioni a destra e a sinistra), n. frame = 1 + N/441;
//  3. normalized="frame_length" -> torch.stft normalized=True: STFT * n_fft^-0.5;
//  4. modulo (power=1);
//  5. filterbank mel torchaudio: 128 bande, f_min 30, f_max 11000, mel_scale "slaney" (Slaney-HTK
//     ibrido: lineare sotto 1 kHz, log sopra), norm=None (triangoli di altezza 1, NON normalizzati
//     per area), n_freqs 513, frequenze = linspace(0, 11025, 513);
//  6. log1p(1000 * x).
// Uscita: frame x 128 float, row-major.
//
// Uso (streaming):  BeatThisFrontend fe;  fe.begin(sr);  fe.push(x, n);  ...  auto spec = fe.finish();
// Chunking per la rete: BeatThisChunking::split(frames), poi stitch() sulle uscite (logit) di ogni chunk.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <utility>
#include <vector>

#include "BeatTracker.hpp"  // beats_detail::RealFFT

namespace repitch {

class BeatThisFrontend {
 public:
  static constexpr int kSampleRate = 22050;
  static constexpr int kNFft = 1024;
  static constexpr int kHop = 441;
  static constexpr int kMels = 128;
  static constexpr double kFMin = 30.0, kFMax = 11000.0;
  static constexpr double kLogMultiplier = 1000.0;

  // Inizia una nuova elaborazione. sampleRate = frequenza del segnale mono che verra' passato a push().
  bool begin(double sampleRate) {
    in_.clear();
    inBase_ = 0;
    outCount_ = 0;
    inTotal_ = 0;
    y_.clear();
    yBase_ = 0;
    yTotal_ = 0;
    nextFrame_ = 0;
    spec_.clear();
    finished_ = false;
    sr_ = static_cast<long long>(std::llround(sampleRate));
    ready_ = sr_ >= 4000;
    if (!ready_) return false;
    initStft();
    initResampler();
    return true;
  }

  // Aggiunge campioni mono (float, qualsiasi n). Chiamabile a pezzi.
  void push(const float* x, std::size_t n) {
    if (!ready_ || finished_ || !x || n == 0) return;
    if (passthrough_) {
      appendResampled(x, n);
    } else {
      in_.insert(in_.end(), x, x + n);
      inTotal_ += n;
      resample(false);
    }
    emitFrames(false);
  }

  // Chiude lo stream e restituisce lo spettrogramma (frame x 128, row-major). Invalida l'istanza
  // fino al prossimo begin().
  std::vector<float> finish() {
    if (!ready_ || finished_) return {};
    if (!passthrough_) resample(true);
    emitFrames(true);
    finished_ = true;
    ready_ = false;
    return std::move(spec_);
  }

  // Numero di frame gia' prodotti (utile per avanzamento).
  std::size_t framesSoFar() const { return spec_.size() / kMels; }

  // Comodo: tutto in un colpo. frames (opzionale) riceve il numero di frame.
  static std::vector<float> compute(const float* mono, std::size_t n, double sampleRate, std::size_t* frames = nullptr) {
    BeatThisFrontend fe;
    std::vector<float> out;
    if (fe.begin(sampleRate)) {
      const std::size_t chunk = 1 << 16;
      for (std::size_t i = 0; i < n; i += chunk) fe.push(mono + i, std::min(chunk, n - i));
      out = fe.finish();
    }
    if (frames) *frames = out.size() / kMels;
    return out;
  }

 private:
  bool ready_ = false, finished_ = false, passthrough_ = false;
  long long sr_ = 44100;

  // ---------------- Ricampionatore polifase (Kaiser) ----------------
  // Posizione di input dell'uscita n: n * in / out (interi, ridotti per mcd). Fase k = (n*in) mod out.
  // Se out > kMaxPhases le fasi sono quantizzate (sr non standard).
  static constexpr long long kMaxPhases = 4096;
  static constexpr double kStopbandDb = 70.0;
  static constexpr double kTransitionHz = 900.0;
  long long rIn_ = 1, rOut_ = 1;      // rapporto ridotto
  long long nPhases_ = 1;
  int taps_ = 0, halfTaps_ = 0;       // taps_ = 2 * halfTaps_
  std::vector<float> table_;          // nPhases_ x taps_
  std::vector<float> in_;
  std::size_t inBase_ = 0, inTotal_ = 0;
  std::size_t outCount_ = 0;          // campioni a 22050 gia' prodotti

  static double besselI0(double x) {
    double s = 1, t = 1;
    for (int k = 1; k < 60; ++k) {
      t *= (x / (2.0 * k)) * (x / (2.0 * k));
      s += t;
      if (t < 1e-14 * s) break;
    }
    return s;
  }

  static long long gcdll(long long a, long long b) { while (b) { const long long t = a % b; a = b; b = t; } return a; }

  void initResampler() {
    passthrough_ = (sr_ == kSampleRate);
    if (passthrough_) return;
    const long long g = gcdll(sr_, kSampleRate);
    rIn_ = sr_ / g;
    rOut_ = kSampleRate / g;
    nPhases_ = std::min(rOut_, kMaxPhases);
    // Banda di transizione [fHi - tw, fHi]: fHi = fine banda di stop (poco oltre f_max mel, ma
    // sotto Nyquist del segnale piu' lento), cosi' le immagini/alias che cadono sotto 11 kHz restano sotto -70 dB.
    const double fHi = std::min(11050.0, 0.5 * double(std::min<long long>(sr_, kSampleRate)));
    const double tw = std::min(kTransitionHz, 0.1 * fHi);
    const double fc = (fHi - 0.5 * tw) / double(sr_);              // cicli per campione di input
    const double dw = 2.0 * beats_detail::kPi * tw / double(sr_);  // larghezza di transizione (rad/campione)
    const double nTapsF = (kStopbandDb - 8.0) / (2.285 * dw);
    halfTaps_ = std::max(8, int(std::ceil(nTapsF / 2.0)));
    taps_ = 2 * halfTaps_;
    const double beta = 0.1102 * (kStopbandDb - 8.7);
    const double i0b = besselI0(beta);
    table_.assign(std::size_t(nPhases_) * std::size_t(taps_), 0.f);
    std::vector<double> h(taps_);
    for (long long k = 0; k < nPhases_; ++k) {
      const double frac = double(k) / double(nPhases_);  // posizione frazionaria dell'uscita tra i0 e i0+1
      double sum = 0;
      for (int j = 0; j < taps_; ++j) {
        const double x = double(j - halfTaps_ + 1) - frac;  // input i0+j-halfTaps_+1 relativo all'uscita
        const double r = x / double(halfTaps_);
        double w = 0;
        if (std::fabs(r) < 1.0) w = besselI0(beta * std::sqrt(1.0 - r * r)) / i0b;
        const double a = 2.0 * beats_detail::kPi * fc * x;
        const double sinc = std::fabs(a) < 1e-12 ? 1.0 : std::sin(a) / a;
        h[j] = 2.0 * fc * sinc * w;
        sum += h[j];
      }
      for (int j = 0; j < taps_; ++j) table_[std::size_t(k) * std::size_t(taps_) + std::size_t(j)] = float(h[j] / sum);
    }
  }

  // Produce le uscite possibili. flush = true: l'input finisce (zero oltre la fine).
  void resample(bool flush) {
    // Numero totale di uscite a fine stream: round(N_in * out / in)
    const std::size_t totalOut = flush ? std::size_t(std::llround(double(inTotal_) * double(kSampleRate) / double(sr_))) : std::size_t(-1);
    std::vector<float> chunk;
    const std::size_t maxChunk = 1 << 15;
    for (;;) {
      chunk.clear();
      while (chunk.size() < maxChunk) {
        const std::size_t n = outCount_ + chunk.size();
        if (flush && n >= totalOut) break;
        const long long num = (long long)n * rIn_;
        const long long i0 = num / rOut_;
        const long long k = num % rOut_;
        // Servono input fino a i0 + halfTaps_ (compreso).
        if (!flush && (std::size_t)(i0 + halfTaps_) >= inTotal_) break;
        const long long ph = (rOut_ <= kMaxPhases) ? k : (k * kMaxPhases + rOut_ / 2) / rOut_ % kMaxPhases;
        const float* hp = table_.data() + std::size_t(ph) * std::size_t(taps_);
        const long long first = i0 - halfTaps_ + 1;
        float acc = 0.f;
        if (first >= (long long)inBase_ && (std::size_t)(first + taps_) <= inBase_ + in_.size()) {
          const float* xp = in_.data() + (std::size_t(first) - inBase_);
          float a0 = 0, a1 = 0, a2 = 0, a3 = 0;
          for (int j = 0; j < taps_; j += 4) {
            a0 += hp[j] * xp[j];
            a1 += hp[j + 1] * xp[j + 1];
            a2 += hp[j + 2] * xp[j + 2];
            a3 += hp[j + 3] * xp[j + 3];
          }
          acc = (a0 + a1) + (a2 + a3);
        } else {  // bordi: zero fuori dal segnale
          for (int j = 0; j < taps_; ++j) {
            const long long idx = first + j;
            if (idx >= (long long)inBase_ && (std::size_t)idx < inBase_ + in_.size()) acc += hp[j] * in_[std::size_t(idx) - inBase_];
          }
        }
        chunk.push_back(acc);
      }
      if (chunk.empty()) break;
      outCount_ += chunk.size();
      appendResampled(chunk.data(), chunk.size());
      if (chunk.size() < maxChunk) break;
    }
    // Scarta l'input che nessuna uscita futura usera'.
    const long long nextI0 = (long long)outCount_ * rIn_ / rOut_;
    const long long keepFrom = nextI0 - halfTaps_ + 1;
    if (keepFrom > (long long)inBase_ + (1 << 16)) {
      const std::size_t drop = std::size_t(keepFrom) - inBase_;
      if (drop <= in_.size()) {
        in_.erase(in_.begin(), in_.begin() + (long long)drop);
        inBase_ += drop;
      }
    }
  }

  // ---------------- STFT + mel ----------------
  struct MelBand { std::size_t lo; std::vector<float> w; };
  std::vector<MelBand> mel_;
  std::vector<float> window_, frame_, mag_;
  beats_detail::RealFFT fft_;
  std::vector<float> y_;                // segnale a 22050 (finestra scorrevole)
  std::size_t yBase_ = 0, yTotal_ = 0;  // indice assoluto di y_[0]; totale campioni prodotti
  std::size_t nextFrame_ = 0;
  std::vector<float> spec_;

  static double hzToMel(double f) {  // torchaudio _hz_to_mel, scala slaney
    const double fSp = 200.0 / 3, minLogHz = 1000.0, minLogMel = minLogHz / fSp, logstep = std::log(6.4) / 27.0;
    return f >= minLogHz ? minLogMel + std::log(f / minLogHz) / logstep : f / fSp;
  }
  static double melToHz(double m) {
    const double fSp = 200.0 / 3, minLogHz = 1000.0, minLogMel = minLogHz / fSp, logstep = std::log(6.4) / 27.0;
    return m >= minLogMel ? minLogHz * std::exp(logstep * (m - minLogMel)) : fSp * m;
  }

  void initStft() {
    fft_.init(kNFft);
    window_.resize(kNFft);
    // torch.hann_window(1024) e' periodica: 0.5 - 0.5 cos(2 pi n / N)
    // Il fattore frame_length (n_fft^-0.5) e' incorporato nella finestra.
    const double norm = 1.0 / std::sqrt(double(kNFft));
    for (int i = 0; i < kNFft; ++i)
      window_[i] = float((0.5 - 0.5 * std::cos(2.0 * beats_detail::kPi * double(i) / double(kNFft))) * norm);
    frame_.assign(kNFft, 0.f);
    mag_.assign(kNFft / 2 + 1, 0.f);
    // melscale_fbanks (torchaudio.functional, norm=None, mel_scale="slaney")
    const int nFreqs = kNFft / 2 + 1;
    const double mMin = hzToMel(kFMin), mMax = hzToMel(kFMax);
    std::vector<double> fPts(kMels + 2);
    for (int i = 0; i < kMels + 2; ++i) fPts[i] = melToHz(mMin + (mMax - mMin) * double(i) / double(kMels + 1));
    mel_.assign(kMels, MelBand());
    for (int m = 0; m < kMels; ++m) {
      const double l = fPts[m], c = fPts[m + 1], r = fPts[m + 2];
      MelBand& b = mel_[m];
      bool started = false;
      for (int k = 0; k < nFreqs; ++k) {
        const double f = (0.5 * double(kSampleRate)) * double(k) / double(nFreqs - 1);  // linspace(0, sample_rate // 2 = 11025, 513)
        const double w = std::max(0.0, std::min((f - l) / (c - l), (r - f) / (r - c)));
        if (w > 0) {
          if (!started) { b.lo = std::size_t(k); started = true; }
          b.w.push_back(float(w));
        } else if (started) {
          break;
        }
      }
      if (!started) b.lo = 0;
    }
  }

  void appendResampled(const float* x, std::size_t n) {
    y_.insert(y_.end(), x, x + n);
    yTotal_ += n;
  }

  // Campione di y con riflessione ai bordi (torch reflect: -k -> k, N-1+k -> N-1-k). total noto solo a fine stream.
  float yAt(long long idx, long long total) const {
    if (idx < 0) idx = -idx;
    if (total > 0 && idx >= total) idx = 2 * (total - 1) - idx;
    if (idx < 0) idx = 0;
    const long long j = idx - (long long)yBase_;
    return (j >= 0 && (std::size_t)j < y_.size()) ? y_[std::size_t(j)] : 0.f;
  }

  void emitFrames(bool flush) {
    const long long half = kNFft / 2;
    const long long N = (long long)yTotal_;
    const long long nFrames = flush ? 1 + N / kHop : -1;
    for (;;) {
      const long long c = (long long)nextFrame_ * kHop;
      if (flush) {
        if ((long long)nextFrame_ >= nFrames) break;
      } else if (c + half >= N) {
        break;  // servono campioni fino a c + half (e riflessione a sinistra fino a half)
      }
      const long long total = flush ? N : 0;
      for (int i = 0; i < kNFft; ++i) frame_[i] = yAt(c - half + i, total) * window_[i];
      fft_.magnitudes(frame_.data(), mag_.data());
      const std::size_t base = spec_.size();
      spec_.resize(base + kMels);
      for (int m = 0; m < kMels; ++m) {
        const MelBand& b = mel_[m];
        float s = 0.f;
        for (std::size_t k = 0; k < b.w.size(); ++k) s += b.w[k] * mag_[b.lo + k];
        spec_[base + std::size_t(m)] = std::log1p(float(kLogMultiplier) * s);
      }
      ++nextFrame_;
    }
    // Scarta i campioni che nessun frame futuro usera' (lascia margine per la riflessione finale).
    const long long needFrom = (long long)nextFrame_ * kHop - half;
    const long long keepFrom = std::min(needFrom, N) - kNFft;  // margine per la riflessione a destra
    if (!flush && keepFrom > (long long)yBase_ + (1 << 16)) {
      const std::size_t drop = std::size_t(keepFrom) - yBase_;
      y_.erase(y_.begin(), y_.begin() + (long long)drop);
      yBase_ += drop;
    }
  }
};

// Chunking usato da beat_this a inferenza (Spect2Frames: chunk_size 1500, border_size 6,
// overlap "keep_first", avoid_short_end). Vedi split_piece / aggregate_prediction in inference.py.
struct BeatThisChunking {
  static constexpr long long kChunk = 1500, kBorder = 6;

  struct Chunk {
    long long start;      // indice (anche negativo) del primo frame del chunk nello spettrogramma
    long long srcBegin;   // frame reali da copiare: [srcBegin, srcEnd)
    long long srcEnd;
    long long padLeft;    // righe di zeri prima
    long long padRight;   // righe di zeri dopo
    long long length() const { return padLeft + (srcEnd - srcBegin) + padRight; }  // = ingresso della rete (1500)
  };

  // Elenco dei chunk per uno spettrogramma di `total` frame.
  static std::vector<Chunk> split(long long total) {
    std::vector<Chunk> out;
    if (total <= 0) return out;
    std::vector<long long> starts;
    const long long step = kChunk - 2 * kBorder;
    for (long long s = -kBorder; s < total - kBorder; s += step) starts.push_back(s);
    if (total > step && !starts.empty()) starts.back() = total - (kChunk - kBorder);  // avoid_short_end
    for (long long s : starts) {
      Chunk c;
      c.start = s;
      c.srcBegin = std::max(s, 0LL);
      c.srcEnd = std::min(s + kChunk, total);
      c.padLeft = std::max(0LL, -s);
      c.padRight = std::max(0LL, std::min(kBorder, s + kChunk - total));
      out.push_back(c);
    }
    return out;
  }

  // Copia nel buffer `dst` (length() x nBins) l'ingresso del chunk, con gli zeri di padding.
  static void fill(const Chunk& c, const float* spec, int nBins, float* dst) {
    const std::size_t row = std::size_t(nBins);
    std::fill(dst, dst + std::size_t(c.length()) * row, 0.f);
    std::copy(spec + std::size_t(c.srcBegin) * row, spec + std::size_t(c.srcEnd) * row, dst + std::size_t(c.padLeft) * row);
  }

  // Compone l'uscita completa (una sola quantita', es. i logit di beat) dalle uscite per chunk
  // (outs[i] ha c.length() valori, uno per frame di ingresso). Esattamente come aggregate_prediction
  // con keep_first: si scartano 6 frame per lato, si scrive in ordine inverso cosi' i chunk
  // precedenti sovrascrivono i successivi. I frame mai coperti restano a -1000.
  static std::vector<float> stitch(const std::vector<Chunk>& chunks, const std::vector<std::vector<float>>& outs,
                                   long long total) {
    std::vector<float> full(std::size_t(std::max(0LL, total)), -1000.f);
    for (std::size_t q = chunks.size(); q-- > 0;) {
      const Chunk& c = chunks[q];
      const std::vector<float>& o = outs[q];
      const long long len = (long long)o.size();
      // porzione tenuta: o[kBorder .. len - kBorder) -> posizioni [start + kBorder, start + kChunk - kBorder)
      for (long long i = kBorder; i < len - kBorder; ++i) {
        const long long pos = c.start + i;  // = start + kBorder + (i - kBorder)
        if (pos >= 0 && pos < total && pos < c.start + kChunk - kBorder) full[std::size_t(pos)] = o[std::size_t(i)];
      }
    }
    return full;
  }
};

}  // namespace repitch
