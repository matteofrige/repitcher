// PitchDetector.hpp — stima della frequenza fondamentale con McLeod Pitch Method (MPM),
// header-only. NSDF (normalized square difference function) + scelta del primo picco
// "chiave" sopra k · massimo + interpolazione parabolica.
//
// MPM invece di YIN/autocorrelazione semplice perché il picco NSDF è già normalizzato
// (clarity 0..1 gratis) e scegliere il PRIMO picco alto evita gli errori d'ottava con
// la fondamentale debole. Non fa allocazioni dopo il costruttore.
#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

namespace repitch {

struct PitchResult {
  float frequency = -1.f;  // Hz, -1 se silenzio / nessun picco
  float clarity = 0.f;     // 0..1
  float rms = 0.f;
};

class PitchDetector {
 public:
  static constexpr float kMinHz = 40.f, kMaxHz = 2000.f;
  static constexpr float kSilenceRms = 0.01f;
  static constexpr float kPeakThreshold = 0.9f;  // k di MPM (0.8–1.0)

  /// windowSize = 0 → ~4096 campioni a 48 kHz, scalato col sampleRate.
  explicit PitchDetector(double sampleRate, int windowSize = 0) { prepare(sampleRate, windowSize); }

  void prepare(double sampleRate, int windowSize = 0) {
    sr_ = sampleRate > 0 ? sampleRate : 48000.0;
    window_ = windowSize > 0 ? windowSize : (int)std::lround(4096.0 * sr_ / 48000.0);
    window_ = std::max(window_, 256);
    minLag_ = std::max(2, (int)std::floor(sr_ / kMaxHz));
    maxLag_ = std::min((int)std::ceil(sr_ / kMinHz), window_ * 3 / 4);
    x_.assign((size_t)window_, 0.f);
    prefix_.assign((size_t)window_ + 1, 0.0);
    nsdf_.assign((size_t)maxLag_ + 2, 0.f);
  }

  int windowSize() const { return window_; }

  /// Analizza gli ULTIMI windowSize() campioni di `samples` (n deve essere ≥ windowSize()).
  PitchResult detect(const float* samples, int n) {
    PitchResult res;
    if (n < window_) return res;
    const float* src = samples + (n - window_);

    // Rimuove la componente continua e accumula le somme dei quadrati (prefisse, in double).
    double mean = 0;
    for (int i = 0; i < window_; ++i) mean += src[i];
    mean /= window_;
    prefix_[0] = 0;
    for (int i = 0; i < window_; ++i) {
      const float v = (float)(src[i] - mean);
      x_[(size_t)i] = v;
      prefix_[(size_t)i + 1] = prefix_[(size_t)i] + (double)v * v;
    }
    // rms del segnale originale (con DC) per la soglia di silenzio: usa la versione senza DC,
    // così un offset del microfono non scambia il silenzio per segnale.
    res.rms = (float)std::sqrt(prefix_[(size_t)window_] / window_);
    if (res.rms < kSilenceRms) return res;

    // NSDF: n(τ) = 2 r(τ) / m(τ), r = Σ x[j]x[j+τ], m = Σ x[j]² + x[j+τ]²
    const float* x = x_.data();
    const int lags = maxLag_ + 1;  // serve un lag in più per vedere se l'ultimo è un massimo
    for (int tau = 0; tau <= lags; ++tau) {
      const int len = window_ - tau;
      // 4 accumulatori indipendenti: spezza la catena di dipendenze e lascia vettorizzare (NEON/SSE)
      // senza -ffast-math.
      float r0 = 0.f, r1 = 0.f, r2 = 0.f, r3 = 0.f;
      const float* a = x;
      const float* b = x + tau;
      int j = 0;
      for (; j + 4 <= len; j += 4) {
        r0 += a[j] * b[j];
        r1 += a[j + 1] * b[j + 1];
        r2 += a[j + 2] * b[j + 2];
        r3 += a[j + 3] * b[j + 3];
      }
      for (; j < len; ++j) r0 += a[j] * b[j];
      const float r = (r0 + r1) + (r2 + r3);
      const double m = prefix_[(size_t)len] + (prefix_[(size_t)window_] - prefix_[(size_t)tau]);
      nsdf_[(size_t)tau] = m > 1e-12 ? (float)(2.0 * r / m) : 0.f;
    }

    // Picchi chiave: massimo di ogni regione positiva, dopo il primo attraversamento sotto zero.
    int tau = 1;
    while (tau < lags && nsdf_[(size_t)tau] > 0.f) ++tau;  // salta il lobo iniziale (τ≈0)
    int peaks[64];
    int np = 0;
    float best = 0.f;
    while (tau < lags && np < 64) {
      while (tau < lags && nsdf_[(size_t)tau] <= 0.f) ++tau;  // fino al prossimo lobo positivo
      int pk = -1;
      float pv = 0.f;
      while (tau < lags && nsdf_[(size_t)tau] > 0.f) {
        if (nsdf_[(size_t)tau] > pv) { pv = nsdf_[(size_t)tau]; pk = tau; }
        ++tau;
      }
      if (pk >= minLag_ && pk <= maxLag_ && pk + 1 <= lags) {
        peaks[np++] = pk;
        best = std::max(best, pv);
      }
    }
    if (np == 0) return res;

    const float cutoff = kPeakThreshold * best;
    int chosen = peaks[0];
    for (int i = 0; i < np; ++i) {
      if (nsdf_[(size_t)peaks[i]] >= cutoff) { chosen = peaks[i]; break; }
    }

    // Interpolazione parabolica sul picco scelto.
    const float y0 = nsdf_[(size_t)chosen - 1], y1 = nsdf_[(size_t)chosen], y2 = nsdf_[(size_t)chosen + 1];
    const float denom = y0 - 2.f * y1 + y2;
    float shift = 0.f, peak = y1;
    if (denom < -1e-9f) {
      shift = 0.5f * (y0 - y2) / denom;
      peak = y1 - 0.25f * (y0 - y2) * shift;
    }
    const double period = chosen + shift;
    res.frequency = (float)(sr_ / period);
    res.clarity = std::min(1.f, std::max(0.f, peak));
    return res;
  }

 private:
  double sr_ = 48000.0;
  int window_ = 4096, minLag_ = 24, maxLag_ = 1200;
  std::vector<float> x_, nsdf_;
  std::vector<double> prefix_;
};

}  // namespace repitch
