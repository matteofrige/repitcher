// Harness del PitchDetector: precisione in cent, ottave, rumore, tempo per frame.
#include <chrono>
#include <cmath>
#include <cstdio>
#include <vector>

#include "../PitchDetector.hpp"

using repitch::PitchDetector;
using repitch::PitchResult;

static int fails = 0;
static unsigned rngState = 4242;
static double rnd() {  // [-1,1)
  rngState = rngState * 1664525u + 1013904223u;
  return ((rngState >> 8) / double(1 << 24)) * 2.0 - 1.0;
}
static double cents(double f, double ref) { return 1200.0 * std::log2(f / ref); }

// Somma di armoniche: amps[h-1] è l'ampiezza dell'armonica h (fase iniziale fissa/variabile).
static std::vector<float> tone(double f0, double sr, int n, const std::vector<double>& amps, double phase0 = 0.3) {
  std::vector<float> y((size_t)n, 0.f);
  for (int i = 0; i < n; ++i) {
    double s = 0;
    for (size_t h = 0; h < amps.size(); ++h) s += amps[h] * std::sin(2 * M_PI * f0 * (h + 1) * i / sr + phase0 * (h + 1));
    y[(size_t)i] = (float)s;
  }
  return y;
}

static void check(bool ok, const char* name, const char* detail) {
  std::printf("%-5s %-30s %s\n", ok ? "PASS" : "FAIL", name, detail);
  if (!ok) ++fails;
}

static void accuracy(const char* label, double f0, double sr, const std::vector<double>& amps, double tolCents) {
  PitchDetector det(sr);
  auto y = tone(f0, sr, det.windowSize() + 3000, amps);
  PitchResult r = det.detect(y.data(), (int)y.size());
  double err = r.frequency > 0 ? cents(r.frequency, f0) : 999;
  char d[160], name[64];
  std::snprintf(name, sizeof name, "%s %.2f Hz @%.0f", label, f0, sr);
  std::snprintf(d, sizeof d, "misurata=%.3f Hz err=%+.3f ct clarity=%.3f rms=%.3f", r.frequency, err, r.clarity, r.rms);
  check(std::fabs(err) <= tolCents && r.clarity > 0.9f, name, d);
}

int main() {
  const double rates[] = {48000.0, 44100.0};
  const double freqs[] = {82.41, 110.0, 440.0, 441.3, 1046.5};
  for (double sr : rates) {
    for (double f : freqs) accuracy("sinusoide", f, sr, {0.5}, 1.0);
    for (double f : freqs) accuracy("armonici", f, sr, {0.5, 0.3, 0.2, 0.1}, 1.0);
  }

  // Fondamentale debole: armoniche 2..5 molto più forti della prima (niente errore d'ottava).
  for (double f : {82.41, 110.0, 196.0, 329.63, 440.0}) {
    PitchDetector det(48000);
    auto y = tone(f, 48000, det.windowSize() + 1000, {0.08, 0.5, 0.45, 0.35, 0.2});
    PitchResult r = det.detect(y.data(), (int)y.size());
    double err = r.frequency > 0 ? cents(r.frequency, f) : 999;
    char d[120], name[64];
    std::snprintf(name, sizeof name, "fondamentale debole %.2f", f);
    std::snprintf(d, sizeof d, "misurata=%.3f Hz err=%+.3f ct clarity=%.3f", r.frequency, err, r.clarity);
    check(std::fabs(err) <= 1.0, name, d);
  }
  // Fondamentale totalmente assente (solo 2f, 3f, 4f): il pitch percepito resta f.
  {
    PitchDetector det(48000);
    auto y = tone(110.0, 48000, det.windowSize() + 1000, {0.0, 0.5, 0.4, 0.3});
    PitchResult r = det.detect(y.data(), (int)y.size());
    double err = r.frequency > 0 ? cents(r.frequency, 110.0) : 999;
    char d[120];
    std::snprintf(d, sizeof d, "misurata=%.3f Hz err=%+.3f ct", r.frequency, err);
    check(std::fabs(err) <= 1.0, "fondamentale assente 110", d);
  }

  // Rumore bianco (ampio, sopra la soglia di silenzio): clarity bassa.
  {
    PitchDetector det(48000);
    std::vector<float> y((size_t)det.windowSize() + 500);
    float maxClarity = 0;
    for (int trial = 0; trial < 20; ++trial) {
      for (auto& v : y) v = (float)(0.3 * rnd());
      maxClarity = std::max(maxClarity, det.detect(y.data(), (int)y.size()).clarity);
    }
    char d[100];
    std::snprintf(d, sizeof d, "clarity max su 20 prove = %.3f (soglia 0.5)", maxClarity);
    check(maxClarity < 0.5f, "rumore bianco", d);
  }
  // Tono + rumore moderato: ancora corretto.
  {
    PitchDetector det(48000);
    auto y = tone(220.0, 48000, det.windowSize() + 500, {0.4, 0.2});
    for (auto& v : y) v += (float)(0.05 * rnd());
    PitchResult r = det.detect(y.data(), (int)y.size());
    double err = r.frequency > 0 ? cents(r.frequency, 220.0) : 999;
    char d[100];
    std::snprintf(d, sizeof d, "err=%+.3f ct clarity=%.3f", err, r.clarity);
    check(std::fabs(err) <= 2.0 && r.clarity > 0.8f, "tono + rumore (SNR~20dB)", d);
  }
  // Silenzio e segnale sotto soglia.
  {
    PitchDetector det(48000);
    std::vector<float> z((size_t)det.windowSize(), 0.f);
    PitchResult a = det.detect(z.data(), (int)z.size());
    auto y = tone(440.0, 48000, det.windowSize(), {0.01});  // rms 0.007
    PitchResult b = det.detect(y.data(), (int)y.size());
    auto dc = std::vector<float>(z.size(), 0.5f);          // solo offset continuo
    PitchResult c = det.detect(dc.data(), (int)dc.size());
    char d[100];
    std::snprintf(d, sizeof d, "zeri=%.0f sotto-soglia=%.0f solo-DC=%.0f", a.frequency, b.frequency, c.frequency);
    check(a.frequency == -1.f && b.frequency == -1.f && c.frequency == -1.f, "silenzio -> -1", d);
  }
  // Estremi del range.
  accuracy("estremo basso", 41.2, 48000, {0.5, 0.3}, 2.0);
  accuracy("estremo alto", 1975.5, 48000, {0.5}, 3.0);

  // Tempo per frame.
  {
    PitchDetector det(48000);
    auto y = tone(110.0, 48000, det.windowSize() + 1000, {0.5, 0.3, 0.2});
    const int iters = 300;
    auto t0 = std::chrono::steady_clock::now();
    float sink = 0;
    for (int i = 0; i < iters; ++i) sink += det.detect(y.data() + (i % 50), (int)y.size() - 50).frequency;
    double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() / iters;
    char d[100];
    std::snprintf(d, sizeof d, "%.3f ms per frame (finestra %d, sink=%.0f)", ms, det.windowSize(), sink);
    check(ms < 5.0, "tempo per frame", d);
  }
  std::printf("fails=%d\n", fails);
  return fails ? 1 : 0;
}
