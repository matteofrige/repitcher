// Harness: main <file.f32> <sampleRate> [truth.beats]
//          main --synth <kind> <out.f32> [sampleRate=44100] [seconds=60]
// Render per l'ascolto: main <file.f32> <sr> [truth.beats|-] --render out.wav
// Con ancoraggi: main <f32> <sr> [truth|-] --anchors anchors.txt (un tempo in secondi per riga)
// kind: eighths | clicks120 | drums | rall | accel | rubato | softlegato | noise
// Il file .f32 e' mono float32 little-endian. Per analizzare audio reale:
//   ffmpeg -i in.mp3 -ac 1 -ar 44100 -f f32le out.f32
//   main out.f32 44100
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "../BeatTracker.hpp"

static unsigned long long rs = 0x9E3779B97F4A7C15ull;
static double rnd() {  // xorshift64*, in [0,1)
  rs ^= rs >> 12; rs ^= rs << 25; rs ^= rs >> 27;
  return double((rs * 2685821657736338717ull) >> 11) / 9007199254740992.0;
}
static double gauss() { return rnd() * 2 - 1; }

typedef std::vector<float> Sig;

static void add(Sig& y, double sr, double t0, const std::vector<float>& s, double amp) {
  long long st = (long long)std::llround(t0 * sr);
  for (size_t i = 0; i < s.size(); ++i) {
    long long k = st + (long long)i;
    if (k >= 0 && k < (long long)y.size()) y[k] += float(amp * s[i]);
  }
}
static std::vector<float> clickBurst(double sr) {
  std::vector<float> s(size_t(0.06 * sr));
  for (size_t i = 0; i < s.size(); ++i) s[i] = float(gauss() * std::exp(-double(i) / sr / 0.008));
  return s;
}
static std::vector<float> kick(double sr) {
  std::vector<float> s(size_t(0.3 * sr));
  double ph = 0;
  for (size_t i = 0; i < s.size(); ++i) {
    double t = i / sr, f = 50 + 120 * std::exp(-t / 0.03);
    ph += 2 * M_PI * f / sr;
    s[i] = float(std::sin(ph) * std::exp(-t / 0.09) * std::min(1.0, t / 0.002));
  }
  return s;
}
static std::vector<float> snare(double sr) {
  std::vector<float> s(size_t(0.25 * sr));
  double prev = 0;
  for (size_t i = 0; i < s.size(); ++i) {
    double t = i / sr, w = gauss(), hp = w - 0.5 * prev;
    prev = w;
    s[i] = float((0.7 * hp + 0.5 * std::sin(2 * M_PI * 190 * t)) * std::exp(-t / 0.07));
  }
  return s;
}
static std::vector<float> hat(double sr) {
  std::vector<float> s(size_t(0.08 * sr));
  double p1 = 0, p2 = 0;
  for (size_t i = 0; i < s.size(); ++i) {
    double w = gauss(), hp = w - p1 - p2 + 0.0; p2 = p1 = w * 0.5;
    s[i] = float(hp * std::exp(-double(i) / sr / 0.012));
  }
  return s;
}
static void addTone(Sig& y, double sr, double t0, double dur, double f0, double amp) {
  size_t st = size_t(t0 * sr), n = size_t(dur * sr);
  for (size_t i = 0; i < n && st + i < y.size(); ++i) {
    double t = i / sr;
    double env = std::min(1.0, t / 0.004) * std::exp(-t * 2.5) * std::min(1.0, (dur - t) / 0.05);
    double s = 0;
    for (int h = 1; h <= 6; ++h) s += std::sin(2 * M_PI * f0 * h * t) / h * (f0 * h < 8000 ? 1 : 0);
    y[st + i] += float(amp * env * s);
  }
}

// Tempo (bpm) in funzione del tempo per i vari kind; restituisce i beat.
static std::vector<double> beatsFor(const std::string& kind, double secs, double first) {
  std::vector<double> b;
  double t = first;
  while (t < secs - 0.3) {
    b.push_back(t);
    double bpm;
    if (kind == "clicks120") bpm = 120;
    else if (kind == "drums") bpm = 96;
    else if (kind == "eighths") bpm = 72;
    else if (kind == "rall") bpm = 110 - 50 * std::min(1.0, t / 40.0);
    else if (kind == "accel") bpm = 70 + 60 * std::min(1.0, t / 40.0);
    else if (kind == "softlegato") bpm = 54 * (1 + 0.08 * std::sin(2 * M_PI * t / 17.0));
    else bpm = 90 * (1 + 0.15 * std::sin(2 * M_PI * t / 12.0));
    t += 60.0 / bpm;
  }
  return b;
}

static Sig synth(const std::string& kind, double sr, double secs, std::vector<double>& truth) {
  Sig y(size_t(secs * sr), 0.f);
  if (kind == "noise") {  // rumore rosa
    double b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (auto& v : y) {
      double w = gauss();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      v = float((b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.1);
      b6 = w * 0.115926;
    }
    return y;
  }
  truth = beatsFor(kind, secs, 0.5);
  if (kind == "clicks120") {
    auto c = clickBurst(sr);
    for (double t : truth) add(y, sr, t, c, 0.7);
  } else if (kind == "drums") {
    auto k = kick(sr), s = snare(sr), h = hat(sr);
    for (size_t i = 0; i < truth.size(); ++i) {
      double t = truth[i], beat = 60.0 / 96.0;
      add(y, sr, t, k, 0.8);
      if (i % 2 == 1) add(y, sr, t, s, 0.5);
      add(y, sr, t, h, 0.2);
      add(y, sr, t + beat / 2, h, 0.15);
    }
  } else if (kind == "eighths") {  // beat a 72 BPM + crome/semicrome continue di pari volume
    const double beat = 60.0 / 72.0;
    for (size_t i = 0; i < truth.size(); ++i)
      for (int k = 0; k < 4; ++k) {  // sedicesimi: stessa forza, altezze casuali
        int m = 55 + int(rnd() * 17);
        if (k == 0) {  // sul beat anche basso + terza (come in un accompagnamento)
          addTone(y, sr, truth[i], 0.6, 440.0 * std::pow(2.0, (36 + int(rnd() * 5) - 69) / 12.0), 0.25);
          addTone(y, sr, truth[i], 0.5, 440.0 * std::pow(2.0, (m - 5 - 69) / 12.0), 0.15);
        }
        addTone(y, sr, truth[i] + k * beat / 4, 0.25, 440.0 * std::pow(2.0, (m - 69) / 12.0), k == 0 ? 0.2 : 0.18);
      }
  } else if (kind == "softlegato") {
    // Note quasi sinusoidali con attacco di 80 ms, legate (si sovrappongono), fondo quieto.
    // Il "beat" di riferimento e' a meta' attacco (inizio nota + 40 ms).
    // Con note "decoy" a frazioni casuali del battito (20-80%, fino a due), stessa forza: sul beat non c'e'
    // niente di speciale oltre alla regolarita' lenta.
    std::vector<std::pair<double, double>> evs;
    for (size_t i = 0; i < truth.size(); ++i) {
      evs.push_back({truth[i], 0.10 + 0.05 * rnd()});
      if (i + 1 < truth.size())
        for (int k = 0; k < 2; ++k)
          if (rnd() < 0.85) evs.push_back({truth[i] + (0.2 + 0.6 * rnd()) * (truth[i + 1] - truth[i]), 0.30 + 0.20 * rnd()});
      std::sort(evs.begin(), evs.end());
    }
    for (size_t i = 0; i < evs.size(); ++i) {
      double t0 = evs[i].first, amp = evs[i].second;
      double dur = (i + 1 < evs.size() ? evs[i + 1].first - t0 : 1.0) + 0.05;
      double f0 = 440.0 * std::pow(2.0, (57 + int(rnd() * 10) - 69) / 12.0);
      size_t st = size_t(t0 * sr), n = size_t(dur * sr);
      for (size_t k = 0; k < n && st + k < y.size(); ++k) {
        double t = double(k) / sr;
        double env = std::min(1.0, t / 0.08) * std::min(1.0, (dur - t) / 0.12);
        y[st + k] += float(amp * env * (std::sin(2 * M_PI * f0 * t) + 0.15 * std::sin(2 * M_PI * 2 * f0 * t)));
      }
    }
    for (auto& t : truth) t += 0.04;
  } else {  // rall / accel / rubato: note tonali
    static const int chord[3][3] = {{0, 4, 7}, {0, 3, 7}, {0, 5, 9}};
    for (size_t i = 0; i < truth.size(); ++i) {
      int root = 48 + int(rnd() * 12), ci = int(rnd() * 3);
      double t = truth[i];
      double dur = (i + 1 < truth.size() ? truth[i + 1] - t : 1.0) * 0.95 + 0.3;
      for (int n = 0; n < 3; ++n)
        addTone(y, sr, t, dur, 440.0 * std::pow(2.0, (root + chord[ci][n] - 69) / 12.0), 0.18);
      if (kind == "rubato" && i + 1 < truth.size() && rnd() < 0.7) {
        double to = 0.5 * (t + truth[i + 1]);
        int m = 60 + int(rnd() * 14);
        addTone(y, sr, to, 0.4, 440.0 * std::pow(2.0, (m - 69) / 12.0), 0.1);
      }
    }
  }
  for (auto& v : y) v += float(0.005 * gauss());
  return y;
}

int main(int argc, char** argv) {
  if (argc >= 4 && !std::strcmp(argv[1], "--synth")) {
    std::string kind = argv[2], out = argv[3];
    double sr = argc > 4 ? std::atof(argv[4]) : 44100, secs = argc > 5 ? std::atof(argv[5]) : 60;
    std::vector<double> truth;
    Sig y = synth(kind, sr, secs, truth);
    FILE* f = std::fopen(out.c_str(), "wb");
    if (!f) return 1;
    std::fwrite(y.data(), sizeof(float), y.size(), f);
    std::fclose(f);
    f = std::fopen((out + ".beats").c_str(), "w");
    if (!f) return 1;
    for (double t : truth) std::fprintf(f, "%.6f\n", t);
    std::fclose(f);
    return 0;
  }
  if (argc < 3) {
    std::fprintf(stderr, "uso: %s <file.f32> <sr> [truth.beats]\n       %s --synth <kind> <out.f32> [sr] [secs]\n", argv[0], argv[0]);
    return 2;
  }
  FILE* f = std::fopen(argv[1], "rb");
  if (!f) { std::fprintf(stderr, "file non leggibile\n"); return 1; }
  std::fseek(f, 0, SEEK_END);
  long sz = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  Sig x(size_t(sz) / sizeof(float));
  if (std::fread(x.data(), sizeof(float), x.size(), f) != x.size()) return 1;
  std::fclose(f);
  double sr = std::atof(argv[2]);
  const char* renderOut = nullptr;
  const char* anchorsFile = nullptr;
  for (int i = 3; i + 1 < argc; ++i) {
    if (!std::strcmp(argv[i], "--render")) renderOut = argv[i + 1];
    if (!std::strcmp(argv[i], "--anchors")) anchorsFile = argv[i + 1];
  }
  std::vector<double> anchors;
  if (anchorsFile) {
    FILE* g = std::fopen(anchorsFile, "r");
    double v;
    while (g && std::fscanf(g, "%lf", &v) == 1) anchors.push_back(v);
    if (g) std::fclose(g);
  }

  auto t0 = std::chrono::steady_clock::now();
  repitch::BeatTracker bt;
  bt.setAnchors(anchors);
  repitch::BeatTrackerResult r = bt.analyze(x.data(), x.size(), sr);
  double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  std::printf("beats=%zu bpm=%.2f conf=%.3f valid=%d unc=%d ratio=%.2f per=%.2f cv=%.3f ld=%.2f ms=%.0f", r.beats.size(), r.medianBpm, r.confidence, r.valid ? 1 : 0, r.uncertain ? 1 : 0, r.ratioScore, r.periodScore, r.ibiCv, r.levelDepth, ms);

  if (renderOut) {
    Sig y(x);
    for (auto& v : y) v *= 0.5f;
    for (double b : r.beats)
      for (size_t i = 0; i < size_t(0.015 * sr); ++i) {
        size_t k = size_t(b * sr) + i;
        if (k < y.size()) y[k] += float(0.5 * std::sin(2 * M_PI * 2000 * i / sr) * std::exp(-double(i) / sr / 0.004));
      }
    FILE* w = std::fopen(renderOut, "wb");
    if (w) {
      uint32_t n = uint32_t(y.size()), sr32 = uint32_t(sr), dl = n * 4, rl = 36 + dl, br = sr32 * 4, fl = 16;
      uint16_t pcm = 1, ch = 2, ba = 4, bits = 16;
      std::fwrite("RIFF", 1, 4, w); std::fwrite(&rl, 4, 1, w); std::fwrite("WAVEfmt ", 1, 8, w);
      std::fwrite(&fl, 4, 1, w); std::fwrite(&pcm, 2, 1, w); std::fwrite(&ch, 2, 1, w); std::fwrite(&sr32, 4, 1, w);
      std::fwrite(&br, 4, 1, w); std::fwrite(&ba, 2, 1, w); std::fwrite(&bits, 2, 1, w);
      std::fwrite("data", 1, 4, w); std::fwrite(&dl, 4, 1, w);
      for (float v : y) { int16_t q = int16_t(std::max(-1.f, std::min(1.f, v)) * 32767); std::fwrite(&q, 2, 1, w); std::fwrite(&q, 2, 1, w); }
      std::fclose(w);
    }
  }
  if (argc > 3 && std::strcmp(argv[3], "--render") && std::strcmp(argv[3], "--anchors") && std::strcmp(argv[3], "-")) {
    std::vector<double> tr;
    FILE* g = std::fopen(argv[3], "r");
    double v;
    while (g && std::fscanf(g, "%lf", &v) == 1) tr.push_back(v);
    if (g) std::fclose(g);
    const double tol = 0.07;
    std::vector<char> used(r.beats.size(), 0);
    size_t tp = 0;
    double sumErr = 0, maxErr = 0, bias = 0;
    for (double t : tr) {
      long best = -1;
      double bd = tol;
      for (size_t i = 0; i < r.beats.size(); ++i) {
        double d = std::fabs(r.beats[i] - t);
        if (!used[i] && d <= bd) { bd = d; best = long(i); }
      }
      if (best >= 0) {
        used[best] = 1; ++tp;
        sumErr += bd * 1000; bias += (r.beats[best] - t) * 1000; maxErr = std::max(maxErr, bd * 1000);
      }
    }
    double P = r.beats.empty() ? 0 : double(tp) / r.beats.size(), Rc = tr.empty() ? 0 : double(tp) / tr.size();
    double F = P + Rc > 0 ? 2 * P * Rc / (P + Rc) : 0;
    std::printf(" F=%.3f mean_err=%.1f max_err=%.1f bias=%.1f", F, tp ? sumErr / tp : 0.0, maxErr, tp ? bias / tp : 0.0);
  }
  if (std::getenv("ADBG")) { for (double b : r.beats) std::fprintf(stderr, "%.3f ", b); std::fprintf(stderr, "\n"); }
  if (!anchors.empty()) {
    double worst = 0;
    for (double ta : anchors) {
      double bd = 1e9;
      for (double b : r.beats) bd = std::min(bd, std::fabs(b - ta));
      worst = std::max(worst, bd * 1000); if (std::getenv("ADBG")) std::fprintf(stderr, "anchor %.3f dev %.1f\n", ta, bd * 1000);
    }
    std::printf(" anchors=%zu anchor_max_dev=%.1fms", anchors.size(), worst);
  }
  std::printf("\n");
  return 0;
}
