// Harness: main <file.f32> <sampleRate>
//          main --synth <kind> <A_hz> <out.f32> [sampleRate=44100] [seconds=60]
// kind: melody | chords | vibrato | pink | melnoise
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "../TuningEstimator.hpp"

static unsigned rngState = 12345;
static double rnd() {
  rngState = rngState * 1664525u + 1013904223u;
  return (rngState >> 8) / double(1 << 24);
}

static const int scale[] = {0, 2, 4, 5, 7, 9, 11};

static void addNote(std::vector<float>& y, size_t start, double dur, double sr, double f0,
                    double amp, double vibCents) {
  size_t n = size_t(dur * sr);
  double ph = rnd() * 6.28318;
  double vph = 0;
  for (size_t i = 0; i < n && start + i < y.size(); ++i) {
    double t = i / sr;
    double env = std::min(1.0, t / 0.02) * std::exp(-t * 3.0) * std::min(1.0, (dur - t) / 0.02);
    double f = f0;
    if (vibCents > 0) f *= std::pow(2.0, vibCents * std::sin(2 * M_PI * 5.0 * (t + vph)) / 1200.0);
    ph += 2 * M_PI * f / sr;
    double s = 0;
    for (int h = 1; h <= 5; ++h) s += std::sin(h * ph) / h;
    y[start + i] += float(amp * env * s);
  }
}

static std::vector<float> synth(const std::string& kind, double A, double sr, double secs) {
  std::vector<float> y(size_t(secs * sr), 0.f);
  auto freq = [&](int midi) { return A * std::pow(2.0, (midi - 69) / 12.0); };
  if (kind == "pink") {
    double b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (auto& v : y) {
      double w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      v = float((b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.1);
      b6 = w * 0.115926;
    }
    return y;
  }
  const bool chords = kind == "chords", vib = kind == "vibrato";
  double noteDur = chords ? 0.8 : 0.4;
  int deg = 14;  // grado sulla scala (14 = C5-ish via ottava), random walk
  for (size_t s = 0; s < y.size(); s += size_t(noteDur * sr)) {
    deg += int(rnd() * 5) - 2;
    deg = std::max(7, std::min(21, deg));
    auto midiOf = [&](int d) { return 48 + 12 * (d / 7) + scale[d % 7]; };
    if (chords) {
      for (int k = 0; k < 3; ++k) addNote(y, s, noteDur, sr, freq(midiOf(deg + 2 * k)), 0.12, 0);
    } else {
      addNote(y, s, noteDur, sr, freq(midiOf(deg)), 0.3, vib ? 20.0 : 0);
    }
  }
  if (kind == "melnoise") {
    double p = 0;
    for (float v : y) p += double(v) * v;
    double rms = std::sqrt(p / y.size());
    auto noise = synth("pink", A, sr, secs);
    double np = 0;
    for (float v : noise) np += double(v) * v;
    double g = rms * 0.1 / std::sqrt(np / noise.size());  // -20 dB
    for (size_t i = 0; i < y.size(); ++i) y[i] += float(noise[i] * g);
  }
  return y;
}

int main(int argc, char** argv) {
  if (argc >= 5 && !strcmp(argv[1], "--synth")) {
    double sr = argc > 5 ? atof(argv[5]) : 44100, secs = argc > 6 ? atof(argv[6]) : 60;
    auto y = synth(argv[2], atof(argv[3]), sr, secs);
    FILE* f = fopen(argv[4] ? argv[4] : "", "wb");
    if (!f) return 1;
    fwrite(y.data(), 4, y.size(), f);
    fclose(f);
    return 0;
  }
  if (argc < 3) { fprintf(stderr, "uso: main <file.f32> <sr>\n"); return 2; }
  FILE* f = fopen(argv[1], "rb");
  if (!f) { perror("open"); return 1; }
  fseek(f, 0, SEEK_END);
  long sz = ftell(f);
  fseek(f, 0, SEEK_SET);
  std::vector<float> d(sz / 4);
  if (fread(d.data(), 4, d.size(), f) != d.size()) return 1;
  fclose(f);
  auto t0 = std::chrono::steady_clock::now();
  auto r = repitch::estimateTuning(d.data(), d.size(), float(atof(argv[2])));
  double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  printf("refHz=%.3f cents=%.3f confidence=%.3f valid=%d peaks=%d ms=%.1f\n", r.refHz, r.cents,
         r.confidence, r.valid, r.peakCount, ms);
  return 0;
}
