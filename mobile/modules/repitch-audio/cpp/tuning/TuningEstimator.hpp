// Stima dell'accordatura di riferimento (La in Hz) da audio mono.
// Header-only, C++17. Nessuno stato globale.
#pragma once
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstddef>
#include <vector>

namespace repitch {

struct TuningEstimate {
  bool valid;        // false se il segnale non è abbastanza tonale
  float cents;       // scostamento da A=440 in [-50, 50)
  float refHz;       // 440 * 2^(cents/1200)
  float confidence;  // 0..1 (concentrazione della media circolare)
  int peakCount;     // picchi usati
};

namespace tuning_detail {

constexpr double kPi = 3.14159265358979323846;

// FFT complessa radix-2 in place (n potenza di 2), con twiddle precalcolati.
inline void fft(std::vector<std::complex<double>>& a,
                const std::vector<std::complex<double>>& tw) {
  const std::size_t n = a.size();
  for (std::size_t i = 1, j = 0; i < n; ++i) {
    std::size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(a[i], a[j]);
  }
  for (std::size_t len = 2; len <= n; len <<= 1) {
    const std::size_t step = n / len, half = len >> 1;
    for (std::size_t i = 0; i < n; i += len)
      for (std::size_t k = 0; k < half; ++k) {
        const std::complex<double> u = a[i + k], v = a[i + k + half] * tw[k * step];
        a[i + k] = u + v;
        a[i + k + half] = u - v;
      }
  }
}

struct Peak {
  float dev;  // scostamento in semitoni [-0.5, 0.5)
  float w;
};

}  // namespace tuning_detail

inline TuningEstimate estimateTuning(const float* mono, std::size_t frames, float sampleRate) {
  using namespace tuning_detail;
  TuningEstimate out{false, 0.f, 440.f, 0.f, 0};
  if (!mono || sampleRate <= 0.f) return out;

  // 1. Decimazione per portare la frequenza a ~22-24 kHz (FIR sinc finestrato, 4*M+1 tap).
  int M = sampleRate > 24000.f ? static_cast<int>(std::ceil(sampleRate / 24000.f)) : 1;
  std::vector<float> x;
  const float fs = sampleRate / static_cast<float>(M);
  if (M == 1) {
    x.assign(mono, mono + frames);
  } else {
    const int half = 8 * M;  // taps = 2*half+1
    std::vector<double> h(2 * half + 1);
    const double fc = 0.45 / M;  // cutoff normalizzato (cicli/campione)
    double sum = 0;
    for (int i = -half; i <= half; ++i) {
      const double s = (i == 0) ? 2 * fc : std::sin(2 * kPi * fc * i) / (kPi * i);
      const double win = 0.5 + 0.5 * std::cos(kPi * i / (half + 1));
      h[i + half] = s * win;
      sum += h[i + half];
    }
    for (auto& v : h) v /= sum;
    if (frames > static_cast<std::size_t>(2 * half)) {
      const std::size_t outN = (frames - 2 * half) / M;
      x.resize(outN);
      for (std::size_t o = 0; o < outN; ++o) {
        const float* p = mono + o * M;
        double acc = 0;
        for (int k = 0; k <= 2 * half; ++k) acc += h[k] * p[k];
        x[o] = static_cast<float>(acc);
      }
    }
  }

  // 2. STFT: N potenza di 2 con risoluzione <= ~3 Hz.
  std::size_t N = 1024;
  while (static_cast<float>(fs) / static_cast<float>(N) > 3.f) N <<= 1;
  if (x.size() < N) return out;
  const std::size_t hop = N / 2;

  std::vector<std::complex<double>> tw(N / 2);
  for (std::size_t k = 0; k < N / 2; ++k)
    tw[k] = std::polar(1.0, -2.0 * kPi * static_cast<double>(k) / static_cast<double>(N));
  std::vector<double> win(N);
  for (std::size_t i = 0; i < N; ++i)
    win[i] = 0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(N));

  const double binHz = static_cast<double>(fs) / static_cast<double>(N);
  const std::size_t kMin = std::max<std::size_t>(2, static_cast<std::size_t>(std::ceil(80.0 / binHz)));
  const std::size_t kMax = std::min<std::size_t>(N / 2 - 2, static_cast<std::size_t>(2500.0 / binHz));
  constexpr int kMaxPeaksPerFrame = 15;

  std::vector<std::complex<double>> buf(N);
  std::vector<double> mag(N / 2 + 1), scratch;
  std::vector<Peak> peaks;
  std::vector<std::pair<double, std::size_t>> cand;

  for (std::size_t start = 0; start + N <= x.size(); start += hop) {
    double energy = 0;
    for (std::size_t i = 0; i < N; ++i) {
      const double v = x[start + i];
      energy += v * v;
      buf[i] = v * win[i];
    }
    if (energy / static_cast<double>(N) < 1e-8) continue;  // silenzio (~ -80 dBFS)
    fft(buf, tw);
    for (std::size_t k = 0; k <= N / 2; ++k) mag[k] = std::abs(buf[k]);

    scratch.assign(mag.begin() + kMin, mag.begin() + kMax + 1);
    std::nth_element(scratch.begin(), scratch.begin() + scratch.size() / 2, scratch.end());
    const double median = scratch[scratch.size() / 2];
    double maxMag = 0;
    for (std::size_t k = kMin; k <= kMax; ++k) maxMag = std::max(maxMag, mag[k]);
    const double thr = std::max(0.10 * maxMag, 8.0 * median);

    cand.clear();
    for (std::size_t k = kMin; k <= kMax; ++k)
      if (mag[k] > thr && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) cand.emplace_back(mag[k], k);
    const std::size_t keep = std::min<std::size_t>(cand.size(), kMaxPeaksPerFrame);
    std::partial_sort(cand.begin(), cand.begin() + keep, cand.end(),
                      [](const auto& a, const auto& b) { return a.first > b.first; });

    for (std::size_t c = 0; c < keep; ++c) {
      const std::size_t k = cand[c].second;
      const double a = std::log(mag[k - 1] + 1e-20), b = std::log(mag[k] + 1e-20),
                   g = std::log(mag[k + 1] + 1e-20);
      const double den = a - 2 * b + g;
      if (den >= 0) continue;
      const double delta = 0.5 * (a - g) / den;
      if (delta < -0.5 || delta > 0.5) continue;
      const double f = (static_cast<double>(k) + delta) * binHz;
      const double midi = 69.0 + 12.0 * std::log2(f / 440.0);
      double dev = midi - std::floor(midi + 0.5);
      peaks.push_back({static_cast<float>(dev), static_cast<float>(std::sqrt(cand[c].first))});
    }
  }

  out.peakCount = static_cast<int>(peaks.size());
  if (peaks.empty()) return out;

  // 3. Media circolare, poi seconda passata sui picchi entro ±25 cents dalla stima.
  auto circ = [&](double center, double halfWidth, double& meanDev, double& R, int& n) {
    double S = 0, C = 0, W = 0;
    n = 0;
    for (const auto& p : peaks) {
      double d = p.dev - center;
      d -= std::floor(d + 0.5);
      if (std::fabs(d) > halfWidth) continue;
      const double ang = 2 * kPi * p.dev;
      S += p.w * std::sin(ang);
      C += p.w * std::cos(ang);
      W += p.w;
      ++n;
    }
    if (W <= 0) { meanDev = 0; R = 0; return; }
    meanDev = std::atan2(S, C) / (2 * kPi);
    R = std::sqrt(S * S + C * C) / W;
  };

  double mean, R;
  int n;
  circ(0, 0.5, mean, R, n);
  const double R1 = R;
  for (int it = 0; it < 2; ++it) circ(mean, 0.25, mean, R, n);
  (void)R;

  out.confidence = static_cast<float>(R1);
  out.cents = static_cast<float>(mean * 100.0);
  if (out.cents >= 50.f) out.cents -= 100.f;
  if (out.cents < -50.f) out.cents += 100.f;
  out.refHz = 440.f * std::pow(2.f, out.cents / 1200.f);
  out.valid = R1 >= 0.3 && out.peakCount >= 200;
  return out;
}

}  // namespace repitch
