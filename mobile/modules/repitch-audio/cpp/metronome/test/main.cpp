// Harness del MetronomeCore: deriva zero, cambio di BPM, accenti, ampiezze, silenzio.
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "../MetronomeCore.hpp"

using repitch::MetronomeCore;
using repitch::MetronomeEvent;

static int fails = 0;
static void check(bool ok, const char* name, const char* detail) {
  std::printf("%-5s %-34s %s\n", ok ? "PASS" : "FAIL", name, detail);
  if (!ok) ++fails;
}

struct Run {
  std::vector<int64_t> onsets;        // onset rilevati dall'audio (primo campione non nullo - 1)
  std::vector<MetronomeEvent> events;
  std::vector<float> peaks;           // picco assoluto di ogni click
  int64_t total = 0;
};

// Rende `frames` frame in blocchi di dimensione variabile; `hook(totalFramesSoFar)` è chiamato tra i blocchi.
template <typename Hook>
static void renderBlocks(MetronomeCore& m, Run& r, int64_t frames, Hook hook) {
  static const int sizes[] = {512, 441, 1024, 64, 480, 333, 1};
  std::vector<float> buf(2048);
  bool prevZero = true;
  size_t k = 0;
  while (r.total < frames) {
    hook(r.total);
    int n = (int)std::min<int64_t>(sizes[k++ % 7], frames - r.total);
    m.render(buf.data(), n, 0);
    for (int i = 0; i < n; ++i) {
      float s = buf[i];
      if (s != 0.f && prevZero) { r.onsets.push_back(r.total + i - 1); r.peaks.push_back(0); }
      if (s != 0.f) r.peaks.back() = std::max(r.peaks.back(), std::fabs(s));
      prevZero = (s == 0.f);
    }
    r.total += n;
    MetronomeEvent e;
    while (m.popEvent(e)) r.events.push_back(e);
  }
}

static void driftTest(double bpm, double sr, double seconds) {
  MetronomeCore m;
  m.prepare(sr);
  m.setBpm(bpm); m.setBeatsPerBar(4); m.setVolume(1.f);
  m.start();
  Run r;
  renderBlocks(m, r, (int64_t)(seconds * sr), [](int64_t) {});
  const double spb = sr * 60.0 / bpm;
  int64_t maxErr = 0, maxEvErr = 0;
  for (size_t n = 0; n < r.onsets.size(); ++n)
    maxErr = std::max<int64_t>(maxErr, std::llabs(r.onsets[n] - (int64_t)std::llround((double)n * spb)));
  for (size_t n = 0; n < r.events.size(); ++n)
    maxEvErr = std::max<int64_t>(maxEvErr, std::llabs(r.events[n].frameTime - (int64_t)std::llround((double)n * spb)));
  char d[200], name[64];
  std::snprintf(name, sizeof name, "drift %.0f BPM @%.0f 10min", bpm, sr);
  std::snprintf(d, sizeof d, "click=%zu eventi=%zu errMax audio=%lld ev=%lld frame", r.onsets.size(), r.events.size(),
                (long long)maxErr, (long long)maxEvErr);
  size_t expected = (size_t)std::ceil(seconds * bpm / 60.0 - 1e-9);
  check(maxErr <= 1 && maxEvErr <= 1 && r.onsets.size() == r.events.size() &&
            (r.onsets.size() == expected || r.onsets.size() + 1 == expected),
        name, d);
}

static void bpmChangeTest(double b0, double b1) {
  const double sr = 48000;
  MetronomeCore m;
  m.prepare(sr);
  m.setBpm(b0); m.setBeatsPerBar(4); m.setVolume(1.f);
  m.start();
  Run r;
  const int64_t half = (int64_t)(30 * sr) + 17777;  // a metà, in un punto non allineato
  bool changed = false;
  renderBlocks(m, r, (int64_t)(60 * sr), [&](int64_t t) {
    if (!changed && t >= half) { m.setBpm(b1); changed = true; }
  });
  const double s0 = sr * 60 / b0, s1 = sr * 60 / b1;
  const double lo = std::min(s0, s1) - 1.5, hi = std::max(s0, s1) + 1.5;
  bool ok = r.onsets.size() == r.events.size();
  size_t bad = 0;
  for (size_t i = 1; i < r.onsets.size(); ++i) {
    double iv = (double)(r.onsets[i] - r.onsets[i - 1]);
    if (iv < lo || iv > hi) ++bad;                                  // battito saltato o doppio
    if (r.events[i].beatIndex != (int)(i % 4)) ok = false;          // sequenza continua
  }
  // Conteggio atteso: battiti prima + dopo il cambio (±1).
  const double tail = 60.0 - (double)half / sr;
  size_t beatsBefore = 0;
  while (beatsBefore < r.onsets.size() && r.onsets[beatsBefore] < half) ++beatsBefore;
  double expectAfter = tail * b1 / 60.0;
  double got = (double)(r.onsets.size() - beatsBefore);
  if (std::fabs(got - expectAfter) > 1.5) ok = false;
  char d[200], name[64];
  std::snprintf(name, sizeof name, "cambio BPM %g -> %g a meta", b0, b1);
  std::snprintf(d, sizeof d, "click=%zu intervalli anomali=%zu dopo=%.0f atteso=%.1f", r.onsets.size(), bad, got, expectAfter);
  check(ok && bad == 0, name, d);
}

static void accentTest(int bpb) {
  const double sr = 44100;
  MetronomeCore m;
  m.prepare(sr);
  m.setBpm(240); m.setBeatsPerBar(bpb); m.setVolume(1.f);
  m.start();
  Run r;
  renderBlocks(m, r, (int64_t)(20 * sr), [](int64_t) {});
  bool ok = r.events.size() == r.onsets.size() && r.events.size() > 20;
  float accMin = 9, accMax = 0, offMax = 0, offMin = 9;
  for (size_t i = 0; i < r.events.size(); ++i) {
    bool acc = (int)(i % bpb) == 0;
    if (r.events[i].accent != acc || r.events[i].beatIndex != (int)(i % bpb)) ok = false;
    if (acc) { accMin = std::min(accMin, r.peaks[i]); accMax = std::max(accMax, r.peaks[i]); }
    else { offMin = std::min(offMin, r.peaks[i]); offMax = std::max(offMax, r.peaks[i]); }
  }
  // Dopo il soft limiter (tanh) il picco è < 1: l'accento resta più forte degli altri battiti.
  if (bpb > 1 && !(accMin > 0.9f && accMax < 1.0f && offMax < 0.8f * accMin && offMin > 0.6f)) ok = false;
  if (bpb == 1 && !(accMin > 0.9f && accMax < 1.0f)) ok = false;
  char d[200], name[64];
  std::snprintf(name, sizeof name, "accento ogni %d battiti", bpb);
  std::snprintf(d, sizeof d, "picchi accento %.3f..%.3f, altri %.3f..%.3f", accMin, accMax, offMin == 9 ? 0 : offMin, offMax);
  check(ok, name, d);
}

static void controlTest() {
  const double sr = 48000;
  MetronomeCore m;
  m.prepare(sr);
  m.setBpm(120); m.setBeatsPerBar(4); m.setVolume(0.5f);
  std::vector<float> buf(4800);
  bool silent = !m.render(buf.data(), 4800);      // fermo: silenzio
  m.start();
  m.render(buf.data(), 4800);
  float pk = 0;
  for (float v : buf) pk = std::max(pk, std::fabs(v));
  bool first = buf[0] == 0.f && buf[1] != 0.f;     // primo click immediato (sample 0 = attacco a 0)
  bool vol = pk > 0.7f && pk < 1.0f;                // tanh(2,5 · 0,5 · picco click)
  m.stop();
  bool silentAfter = !m.render(buf.data(), 4800);
  m.start();                                       // ripartenza: di nuovo click immediato
  m.render(buf.data(), 480);
  bool restart = buf[1] != 0.f;
  m.setBpm(1000); m.setBeatsPerBar(99);            // clamp
  m.render(buf.data(), 480);
  char d[160];
  std::snprintf(d, sizeof d, "silenzio=%d primoClick=%d volume(pk=%.3f)=%d stop=%d restart=%d", silent, first, pk, vol, silentAfter, restart);
  check(silent && first && vol && silentAfter && restart, "start/stop/volume", d);
}

static void perfTest() {
  MetronomeCore m;
  m.prepare(48000);
  m.setBpm(300); m.start();
  std::vector<float> buf(512);
  auto t0 = std::chrono::steady_clock::now();
  const int iters = 20000;
  for (int i = 0; i < iters; ++i) m.render(buf.data(), 512);
  double us = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count() / iters;
  char d[120];
  std::snprintf(d, sizeof d, "%.2f us per blocco da 512 frame (budget 10667 us)", us);
  check(us < 500, "perf render", d);
}

static void scheduledTest() {
  const double sr = 48000;
  MetronomeCore m;
  m.prepare(sr);
  m.setBeatsPerBar(4); m.setVolume(1.f);
  m.setFollow(true);
  int64_t fr; uint64_t tag;
  std::vector<float> buf(2048);
  bool noBlock = !m.lastBlock(fr, tag);
  // Click a frame esatti, anche dentro un blocco; il generatore interno resta muto (anche con start()).
  m.start();
  const int64_t targets[] = {1000, 5123, 5123 + 24000, 70000};
  for (int i = 0; i < 4; ++i) m.scheduleClick(targets[i], i % 4 == 0, i);
  Run r;
  renderBlocks(m, r, 100000, [](int64_t) {});
  bool ok = r.onsets.size() == 4 && r.events.size() == 4;
  for (size_t i = 0; ok && i < 4; ++i)
    if (r.events[i].frameTime != targets[i] || std::llabs(r.onsets[i] - targets[i]) > 1 || r.events[i].beatIndex != (int)i) ok = false;
  bool mapped = m.lastBlock(fr, tag) && fr > 90000 && fr <= 100000;
  char d[200];
  std::snprintf(d, sizeof d, "click=%zu eventi=%zu primo=%lld", r.onsets.size(), r.events.size(),
                r.onsets.empty() ? -1LL : (long long)r.onsets[0]);
  check(noBlock && ok && mapped, "click programmati esatti", d);

  // Modalità silenziosa: eventi sì, audio no.
  {
    MetronomeCore q;
    q.prepare(sr); q.setFollow(true); q.setFollowClickAudible(false); q.setVolume(1.f);
    q.scheduleClick(3000, true, 0);
    q.scheduleClick(9000, false, 1);
    Run rs;
    renderBlocks(q, rs, 20000, [](int64_t) {});
    std::snprintf(d, sizeof d, "click=%zu eventi=%zu", rs.onsets.size(), rs.events.size());
    check(rs.onsets.empty() && rs.events.size() == 2 && rs.events[1].frameTime == 9000, "follow silenzioso: solo eventi", d);
  }
  // Ritardo < 1 blocco: suona a inizio blocco; più vecchio: scartato.
  {
    MetronomeCore q;
    q.prepare(sr); q.setFollow(true); q.setVolume(1.f);
    q.render(buf.data(), 1000);                 // frame_ = 1000
    q.scheduleClick(900, false, 0);              // 100 frame fa, blocco da 512 -> suona a 0
    q.scheduleClick(1100, false, 1);             // dentro il blocco
    q.render(buf.data(), 512);
    MetronomeEvent e; std::vector<MetronomeEvent> ev;
    while (q.popEvent(e)) ev.push_back(e);
    bool late = ev.size() == 2 && ev[0].frameTime == 1000 && ev[1].frameTime == 1100;
    q.scheduleClick(100, false, 2);              // troppo vecchio
    q.render(buf.data(), 512);
    while (q.popEvent(e)) ev.push_back(e);
    check(late && ev.size() == 2, "click in ritardo / scartati", late ? "ok" : "fuori posto");
  }
  // clearScheduled: i click già in coda spariscono, quelli successivi no.
  {
    MetronomeCore q;
    q.prepare(sr); q.setFollow(true); q.setVolume(1.f);
    q.scheduleClick(2000, false, 0);
    q.scheduleClick(3000, false, 1);
    q.render(buf.data(), 512);                   // il primo è in attesa nel render
    q.clearScheduled();
    q.scheduleClick(4000, true, 2);
    Run rc;
    rc.total = 512;
    renderBlocks(q, rc, 6000, [](int64_t) {});
    std::snprintf(d, sizeof d, "eventi=%zu", rc.events.size());
    check(rc.events.size() == 1 && rc.events[0].beatIndex == 2 && rc.events[0].frameTime == 4000, "clearScheduled", d);
  }
  // Spento follow: niente click programmati.
  {
    MetronomeCore q;
    q.prepare(sr); q.setVolume(1.f);
    q.scheduleClick(100, false, 0);
    q.render(buf.data(), 512);
    MetronomeEvent e;
    check(!q.popEvent(e), "senza follow nessun click programmato", "ok");
  }
}

int main() {
  scheduledTest();
  driftTest(120, 48000, 600);
  driftTest(97, 48000, 600);
  driftTest(97, 44100, 600);
  driftTest(300, 48000, 600);
  driftTest(20, 48000, 600);
  bpmChangeTest(120, 90);
  bpmChangeTest(60, 200);
  bpmChangeTest(97, 97.5);
  accentTest(3);
  accentTest(4);
  accentTest(1);
  controlTest();
  perfTest();
  std::printf("fails=%d\n", fails);
  return fails ? 1 : 0;
}
