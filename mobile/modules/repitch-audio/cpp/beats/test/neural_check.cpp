// Strumento di verifica per BeatThisFrontend + analyzeActivation. Pilotato da neural_check.py.
//   neural_check spec   in.f32 sr out.f32          spettrogramma log-mel (frame x 128) + tempi
//   neural_check chunks N                          stampa start dei chunk per N frame
//   neural_check stitch N in.f32 out.f32           compone N frame da uscite per chunk (concatenate)
//   neural_check act    beat.f32 down.f32 fps out.txt   analyzeActivation + downbeatPhase (N=3,4)
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "../BeatThisFrontend.hpp"
#include "../BeatTracker.hpp"

static std::vector<float> readF32(const char* p) {
  FILE* f = std::fopen(p, "rb");
  if (!f) { std::fprintf(stderr, "cannot open %s\n", p); std::exit(2); }
  std::fseek(f, 0, SEEK_END);
  long s = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  std::vector<float> x(size_t(s) / 4);
  if (std::fread(x.data(), 4, x.size(), f) != x.size()) std::exit(2);
  std::fclose(f);
  return x;
}
static void writeF32(const char* p, const std::vector<float>& x) {
  FILE* f = std::fopen(p, "wb");
  std::fwrite(x.data(), 4, x.size(), f);
  std::fclose(f);
}

int main(int argc, char** argv) {
  using namespace repitch;
  if (argc < 2) return 1;
  const std::string m = argv[1];
  if (m == "spec" && argc >= 5) {
    std::vector<float> x = readF32(argv[2]);
    const double sr = std::atof(argv[3]);
    auto t0 = std::chrono::steady_clock::now();
    BeatThisFrontend fe;
    fe.begin(sr);
    // a blocchi irregolari, come farebbe un decoder in streaming
    size_t i = 0, step = 4096;
    while (i < x.size()) { size_t n = std::min(step, x.size() - i); fe.push(x.data() + i, n); i += n; step = step * 3 / 2 + 1; if (step > 100000) step = 777; }
    std::vector<float> spec = fe.finish();
    auto t1 = std::chrono::steady_clock::now();
    const double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    writeF32(argv[4], spec);
    std::printf("frames=%zu time_ms=%.1f audio_s=%.1f rtf=%.4f\n", spec.size() / 128, ms, x.size() / sr, ms / 1000.0 / (x.size() / sr));
    return 0;
  }
  if (m == "chunks" && argc >= 3) {
    for (auto& c : BeatThisChunking::split(std::atoll(argv[2])))
      std::printf("%lld %lld %lld %lld %lld\n", c.start, c.srcBegin, c.srcEnd, c.padLeft, c.padRight);
    return 0;
  }
  if (m == "stitch" && argc >= 5) {
    const long long N = std::atoll(argv[2]);
    auto chunks = BeatThisChunking::split(N);
    std::vector<float> all = readF32(argv[3]);
    std::vector<std::vector<float>> outs;
    size_t off = 0;
    for (auto& c : chunks) { outs.emplace_back(all.begin() + off, all.begin() + off + size_t(c.length())); off += size_t(c.length()); }
    writeF32(argv[4], BeatThisChunking::stitch(chunks, outs, N));
    return 0;
  }
  if (m == "act" && argc >= 6) {
    std::vector<float> b = readF32(argv[2]), d = readF32(argv[3]);
    const double fps = std::atof(argv[4]);
    BeatTracker bt;
    auto r = bt.analyzeActivation(b.data(), b.size(), fps, d.data());
    FILE* f = std::fopen(argv[5], "w");
    for (double t : r.beats) std::fprintf(f, "%.4f\n", t);
    std::fclose(f);
    std::printf("bpm=%.2f n=%zu conf=%.3f valid=%d unc=%d", r.medianBpm, r.beats.size(), r.confidence, r.valid, r.uncertain);
    for (int n : {3, 4}) {
      float mg = 0;
      int ph = BeatTracker::downbeatPhase(r.beats, d.data(), d.size(), fps, n, &mg);
      std::printf(" N%d:phase=%d,margin=%.3f", n, ph, mg);
    }
    std::printf("\n");
    return 0;
  }
  return 1;
}
