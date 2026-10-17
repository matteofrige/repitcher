// Beat tracker offline che segue i cambi di tempo (rallentando/accelerando).
// Header-only, C++17, solo STL. Nessuno stato globale.
//
// Pipeline:
//  1. attivazione di onset a ~100 fps: STFT (Hann ~46 ms) -> filterbank log (3 bande/ottava)
//     -> compressione log -> flusso spettrale superflux -> sottrazione media mobile -> [0,1];
//  2. decodifica con HMM a tempo variabile (Krebs/Bock/Widmer 2015, "efficient state space"),
//     Viterbi in dominio log con backpointer memorizzati solo per gli stati p = 0;
//  3. raffinamento dei beat a precisione sub-frame (interpolazione parabolica).
//
// Uso (thread di background, traccia intera):
//   repitch::BeatTracker bt;  bt.begin(sr);  bt.push(x, n);  ...  auto r = bt.finish();
// oppure  bt.analyze(x, n, sr).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace repitch {

struct BeatTrackerResult {
  std::vector<double> beats;  // secondi, crescenti
  double medianBpm = 0;       // tempo mediano
  float confidence = 0;       // 0..1: quanto l'attivazione sta sui beat
  bool valid = false;         // false se troppo pochi beat / segnale senza ritmo
  bool uncertain = false;     // valido ma poco affidabile: l'utente dovrebbe verificare all'ascolto
  // Diagnostica (usata dall'harness per tarare le soglie).
  float ratioScore = 0, periodScore = 0, ibiCv = 0, levelDepth = 0;
};

namespace beats_detail {

constexpr double kPi = 3.14159265358979323846;

// FFT reale di N punti tramite FFT complessa di N/2 punti (trucco z[n] = x[2n] + i x[2n+1]).
class RealFFT {
 public:
  void init(std::size_t n) {
    N_ = n;
    M_ = n / 2;
    cosM_.resize(M_ / 2 > 0 ? M_ / 2 : 1);
    sinM_.resize(cosM_.size());
    for (std::size_t k = 0; k < cosM_.size(); ++k) {
      cosM_[k] = std::cos(-2.0 * kPi * double(k) / double(M_));
      sinM_[k] = std::sin(-2.0 * kPi * double(k) / double(M_));
    }
    cosN_.resize(M_ + 1);
    sinN_.resize(M_ + 1);
    for (std::size_t k = 0; k <= M_; ++k) {
      cosN_[k] = std::cos(-2.0 * kPi * double(k) / double(N_));
      sinN_[k] = std::sin(-2.0 * kPi * double(k) / double(N_));
    }
    rev_.resize(M_);
    std::size_t bits = 0;
    while ((std::size_t(1) << bits) < M_) ++bits;
    for (std::size_t i = 0; i < M_; ++i) {
      std::size_t r = 0;
      for (std::size_t b = 0; b < bits; ++b)
        if (i & (std::size_t(1) << b)) r |= std::size_t(1) << (bits - 1 - b);
      rev_[i] = static_cast<std::uint32_t>(r);
    }
    re_.assign(M_, 0.0);
    im_.assign(M_, 0.0);
  }
  // x: N campioni reali. Scrive in mag i moduli dei bin 0..N/2.
  void magnitudes(const float* x, float* mag) {
    for (std::size_t i = 0; i < M_; ++i) {
      const std::size_t r = rev_[i];
      re_[r] = x[2 * i];
      im_[r] = x[2 * i + 1];
    }
    for (std::size_t len = 2; len <= M_; len <<= 1) {
      const std::size_t half = len >> 1, step = M_ / len;
      for (std::size_t i = 0; i < M_; i += len)
        for (std::size_t k = 0; k < half; ++k) {
          const double wr = cosM_[k * step], wi = sinM_[k * step];
          const std::size_t a = i + k, b = a + half;
          const double vr = re_[b] * wr - im_[b] * wi;
          const double vi = re_[b] * wi + im_[b] * wr;
          re_[b] = re_[a] - vr;
          im_[b] = im_[a] - vi;
          re_[a] += vr;
          im_[a] += vi;
        }
    }
    for (std::size_t k = 0; k <= M_; ++k) {
      const std::size_t k1 = k % M_, k2 = (M_ - k) % M_;
      const double zr = re_[k1], zi = im_[k1], cr = re_[k2], ci = -im_[k2];
      const double er = 0.5 * (zr + cr), ei = 0.5 * (zi + ci);   // parte pari
      const double dr = 0.5 * (zi - ci), di = -0.5 * (zr - cr);  // (Z - conj)/2i
      const double xr = er + cosN_[k] * dr - sinN_[k] * di;
      const double xi = ei + cosN_[k] * di + sinN_[k] * dr;
      mag[k] = static_cast<float>(std::sqrt(xr * xr + xi * xi));
    }
  }

 private:
  std::size_t N_ = 0, M_ = 0;
  std::vector<double> cosM_, sinM_, cosN_, sinN_, re_, im_;
  std::vector<std::uint32_t> rev_;
};

}  // namespace beats_detail

class BeatTracker {
 public:
  struct Options {
    double minBpm = 40, maxBpm = 220;
    double fps = 100;
    double tempoChangeLambda = 100;
    double observationLambda = 16;  // larghezza regione beat = tau/observationLambda
    // Prior log-normale sul tempo (per beat, all'ingresso in (tau,0) e nella distribuzione iniziale):
    // contrasta l'aggancio alle suddivisioni (ottavi/sedicesimi) tipico di classica/barocco.
    // sigma in unita' log2 (0.55 ~ un'ottava sopra/sotto pesa ~ -1.65 in log). 0 = prior spento.
    double tempoPriorBpm = 105, tempoPriorSigma = 0.55;
  };

  BeatTracker() = default;
  explicit BeatTracker(Options o) : opt_(o) {}

  void begin(double sampleRate) {
    sr_ = sampleRate;
    total_ = 0;
    bufStart_ = 0;
    nextFrame_ = 0;
    buf_.clear();
    flux_.clear();
    lvl_.clear();
    havePrev_ = false;
    ready_ = sampleRate >= 8000.0;
    if (!ready_) return;
    hop_ = std::max<std::size_t>(1, std::size_t(std::llround(sr_ / opt_.fps)));
    effFps_ = sr_ / double(hop_);
    win_ = 1;
    while (double(win_) < 0.046 * sr_) win_ <<= 1;
    fft_.init(win_);
    hann_.resize(win_);
    for (std::size_t i = 0; i < win_; ++i)
      hann_[i] = float(0.5 - 0.5 * std::cos(2.0 * beats_detail::kPi * double(i) / double(win_)));
    frameBuf_.assign(win_, 0.f);
    mag_.assign(win_ / 2 + 1, 0.f);
    buildFilterbank();
    prev_.assign(bands_.size(), 0.f);
    cur_.assign(bands_.size(), 0.f);
  }

  // Tempi (secondi) in cui l'utente ha battuto a tempo (gia' compensati per la latenza).
  // Da chiamare prima di finish()/analyze(). Vuoto = nessun vincolo.
  void setAnchors(std::vector<double> seconds) {
    std::sort(seconds.begin(), seconds.end());
    seconds.erase(std::unique(seconds.begin(), seconds.end()), seconds.end());
    anchors_ = std::move(seconds);
  }

  void push(const float* mono, std::size_t n) {
    if (!ready_ || !mono || n == 0) return;
    buf_.insert(buf_.end(), mono, mono + n);
    total_ += n;
    processFrames(false);
  }

  BeatTrackerResult finish() {
    BeatTrackerResult res;
    if (!ready_) return res;
    processFrames(true);
    ready_ = false;
    std::vector<float> a = makeActivation();
    std::vector<float>().swap(flux_);
    std::vector<float>().swap(buf_);
    res.levelDepth = levelDepth(lvl_);
    std::vector<float>().swap(lvl_);
    decode(a, res);
    return res;
  }

  BeatTrackerResult analyze(const float* mono, std::size_t n, double sampleRate) {
    begin(sampleRate);
    const std::size_t chunk = 1 << 16;
    for (std::size_t i = 0; i < n; i += chunk) push(mono + i, std::min(chunk, n - i));
    return finish();
  }

 private:
  // Il flusso di un onset raggiunge il picco prima del suo istante reale perche' la finestra
  // lo "vede" appena entra nel suo bordo: costante calibrata con i click sintetici
  // (frazione della durata della finestra).
  static constexpr double kOnsetShiftWin = 0.12;
  static constexpr int kMaxHalfRegion = 1;
  static constexpr float kActPower = 2.f;  // rende l'attivazione piu' sparsa (vedi modello di osservazione)

  static constexpr long long kAnchorWin = 3;      // frame
  static constexpr float kAnchorBonus = 40.f;     // log, sullo stato p == 0 (un solo beat per finestra) entro +-kAnchorWin
  static constexpr float kTauOutPenalty = 2.f;    // log per frame, tau fuori dal tempo battuto
  static constexpr float kValidConfidence = 0.15f, kUncertainConfidence = 0.35f;
  static constexpr float kMinLevelDepth = 0.45f, kMaxIbiCv = 0.25f;
  Options opt_;
  std::vector<double> anchors_;
  double sr_ = 44100, effFps_ = 100;
  std::size_t hop_ = 441, win_ = 2048;
  bool ready_ = false, havePrev_ = false;
  std::size_t total_ = 0, bufStart_ = 0, nextFrame_ = 0;
  std::vector<float> buf_, hann_, frameBuf_, mag_, prev_, cur_, flux_, lvl_;
  beats_detail::RealFFT fft_;

  struct Band { std::size_t lo; std::vector<float> w; };
  std::vector<Band> bands_;

  void buildFilterbank() {
    bands_.clear();
    const double fmax = std::min(16000.0, sr_ / 2.0), fmin = 30.0;
    const double binHz = sr_ / double(win_);
    std::vector<double> f;
    for (int i = 0;; ++i) {
      const double fi = fmin * std::pow(2.0, i / 3.0);
      f.push_back(fi);
      if (fi > fmax) break;
    }
    for (std::size_t i = 1; i + 1 < f.size(); ++i) {
      const double l = f[i - 1], c = f[i], r = f[i + 1];
      if (c > fmax) break;
      Band b;
      std::size_t first = std::size_t(std::ceil(l / binHz)), last = std::size_t(std::floor(r / binHz));
      last = std::min(last, win_ / 2);
      if (first > last) continue;
      b.lo = first;
      for (std::size_t k = first; k <= last; ++k) {
        const double hz = double(k) * binHz;
        const double w = hz <= c ? (hz - l) / (c - l) : (r - hz) / (r - c);
        b.w.push_back(float(std::max(0.0, w)));
      }
      double s = 0;
      for (float w : b.w) s += w;
      if (s < 1e-6) continue;  // banda piu' stretta di un bin: scartata
      for (float& w : b.w) w = float(w / s);  // media pesata dei moduli
      bands_.push_back(std::move(b));
    }
  }

  void processFrames(bool flush) {
    if (flush) buf_.insert(buf_.end(), win_ / 2 + 1, 0.f);
    const std::size_t half = win_ / 2;
    // Moduli scalati cosi' che una sinusoide di ampiezza 1 valga ~1.
    const float scale = 2.f / float(win_ * 0.5);
    const float gain = 100.f;
    for (;;) {
      const std::size_t c = nextFrame_ * hop_;
      if (flush ? c >= total_ : c + half > total_) break;
      for (std::size_t i = 0; i < win_; ++i) {
        const long long idx = (long long)c - (long long)half + (long long)i;
        float s = 0.f;
        if (idx >= 0) {
          const std::size_t j = std::size_t(idx) - bufStart_;
          if (j < buf_.size()) s = buf_[j];
        }
        frameBuf_[i] = s * hann_[i];
      }
      fft_.magnitudes(frameBuf_.data(), mag_.data());
      for (std::size_t b = 0; b < bands_.size(); ++b) {
        const Band& bd = bands_[b];
        float s = 0.f;
        for (std::size_t k = 0; k < bd.w.size(); ++k) s += bd.w[k] * mag_[bd.lo + k];
        cur_[b] = std::log(1.f + gain * scale * s);
      }
      float fl = 0.f;
      if (havePrev_) {
        const std::size_t nb = bands_.size();
        for (std::size_t b = 0; b < nb; ++b) {
          float m = prev_[b];
          if (b > 0) m = std::max(m, prev_[b - 1]);
          if (b + 1 < nb) m = std::max(m, prev_[b + 1]);
          const float d = cur_[b] - m;
          if (d > 0) fl += d;
        }
      }
      {
        float m = 0.f;
        for (float v : cur_) m = std::max(m, v);  // banda piu' forte: sensibile anche a note strette
        lvl_.push_back(m);
      }
      flux_.push_back(fl);
      prev_.swap(cur_);
      havePrev_ = true;
      ++nextFrame_;
    }
    // Scarta i campioni che nessun frame futuro usera'.
    const std::size_t need = nextFrame_ * hop_ > half ? nextFrame_ * hop_ - half : 0;
    if (need > bufStart_ + (1 << 16) && need - bufStart_ <= buf_.size()) {
      buf_.erase(buf_.begin(), buf_.begin() + (need - bufStart_));
      bufStart_ = need;
    }
  }

  std::vector<float> makeActivation() const {
    const std::size_t n = flux_.size();
    std::vector<float> a(n, 0.f);
    if (n < 3) return a;
    std::vector<double> ps(n + 1, 0.0);
    for (std::size_t i = 0; i < n; ++i) ps[i + 1] = ps[i] + flux_[i];
    const long long h = std::max<long long>(1, std::llround(0.1 * effFps_));
    for (long long i = 0; i < (long long)n; ++i) {
      const long long lo = std::max<long long>(0, i - h), hi = std::min<long long>((long long)n - 1, i + h);
      const double mean = (ps[hi + 1] - ps[lo]) / double(hi - lo + 1);
      a[i] = float(std::max(0.0, double(flux_[i]) - mean));
    }
    std::vector<float> t(a);
    const std::size_t k = std::min(n - 1, std::size_t(0.99 * double(n)));
    std::nth_element(t.begin(), t.begin() + k, t.end());
    const float p99 = t[k];
    if (p99 < 1e-6f) {
      std::fill(a.begin(), a.end(), 0.f);
      return a;
    }
    for (float& v : a) { v = std::min(1.f, v / p99); v = std::pow(v, kActPower); }
    return a;
  }

  // Mediana, sulle finestre di ~8 s con energia, del massimo dell'autocorrelazione normalizzata
  // (a media nulla) dell'attivazione per ritardi nell'intervallo dei tempi ammessi. Musica: >0.3;
  // rumore: ~0.1. Finestre corte per tollerare rallentando/accelerando.
  // Coefficiente di variazione robusto (1.4826*MAD/mediana) degli intervalli tra beat consecutivi.
  static double ibiCv(const std::vector<double>& b) {
    if (b.size() < 3) return 1.0;
    std::vector<double> ib;
    for (std::size_t i = 1; i < b.size(); ++i) ib.push_back(b[i] - b[i - 1]);
    std::vector<double> t(ib);
    std::nth_element(t.begin(), t.begin() + t.size() / 2, t.end());
    const double med = t[t.size() / 2];
    for (double& v : t) v = std::fabs(v - med);
    // (sopra: t e' stato permutato ma contiene gli stessi valori; ricalcolo dagli ib)
    t.clear();
    for (double v : ib) t.push_back(std::fabs(v - med));
    std::nth_element(t.begin(), t.begin() + t.size() / 2, t.end());
    return med > 1e-9 ? 1.4826 * t[t.size() / 2] / med : 1.0;
  }

  // Profondita' di modulazione del livello: p90 - p10 del livello della banda piu' forte (log) smoothed a ~0.3 s.
  // Il rumore stazionario resta quasi piatto, un brano con note/silenzi/dinamica no.
  float levelDepth(const std::vector<float>& l) const {
    const std::size_t n = l.size();
    const std::size_t h = std::max<std::size_t>(1, std::size_t(0.15 * effFps_));
    if (n < 2 * h + 10) return 0.f;
    std::vector<float> sm;
    double acc = 0;
    for (std::size_t i = 0; i < n; ++i) {
      acc += l[i];
      if (i >= 2 * h) acc -= l[i - 2 * h];
      if (i >= 2 * h) sm.push_back(float(acc / double(2 * h)));
    }
    std::sort(sm.begin(), sm.end());
    return sm[std::size_t(0.9 * double(sm.size() - 1))] - sm[std::size_t(0.1 * double(sm.size() - 1))];
  }

  static double periodicity(const std::vector<float>& a, int lagMin, int lagMax) {
    const std::size_t n = a.size(), W = std::max<std::size_t>(std::size_t(lagMax) * 3, 800);
    if (n < W) return 0.0;
    std::vector<double> best, x(W);
    for (std::size_t st = 0; st + W <= n; st += W / 2) {
      double m = 0;
      for (std::size_t i = 0; i < W; ++i) m += a[st + i];
      m /= double(W);
      double e = 0;
      for (std::size_t i = 0; i < W; ++i) { x[i] = a[st + i] - m; e += x[i] * x[i]; }
      if (e < 1e-3) continue;
      double mx = 0;
      for (int l = lagMin; l <= lagMax; ++l) {
        double c = 0;
        for (std::size_t i = 0; i + std::size_t(l) < W; ++i) c += x[i] * x[i + std::size_t(l)];
        mx = std::max(mx, c / e);
      }
      best.push_back(mx);
    }
    if (best.empty()) return 0.0;
    std::nth_element(best.begin(), best.begin() + best.size() / 2, best.end());
    return best[best.size() / 2];
  }

  int tauMinF() const { return std::max(2, int(std::lround(60.0 * effFps_ / opt_.maxBpm))); }
  int tauMaxF() const { return std::max(tauMinF(), int(std::lround(60.0 * effFps_ / opt_.minBpm))); }

  // Frame (frazionario) di un tempo in secondi, inverso della conversione finale dei beat.
  double timeToFrame(double sec) const { return (sec - kOnsetShiftWin * double(win_) / sr_) * sr_ / double(hop_); }

  // Decodifica Viterbi: restituisce i frame dei beat (stati p == 0). Se ci sono ancoraggi li impone.
  std::vector<std::size_t> viterbi(const std::vector<float>& a, bool useAnchors) const {
    const std::size_t T = a.size();
    const int tauMin = tauMinF(), tauMax = tauMaxF();
    const int nTau = tauMax - tauMin + 1;
    std::vector<std::size_t> bf;
    if (T < std::size_t(4 * tauMax)) return bf;

    // Ancoraggi: bonus sullo stato beat (p == 0) entro +-kAnchorWin frame; con >= 4 tap
    // consecutivi ravvicinati (< 2.5 s) il tempo locale e' noto: i tau fuori da +-15% sono penalizzati.
    std::vector<float> bonus;
    std::vector<int> segLo, segHi;  // per frame: indici tau ammessi [segLo, segHi]; -1 = nessun vincolo
    if (useAnchors && !anchors_.empty()) {
      bonus.assign(T, 0.f);
      std::vector<double> af;
      for (double t : anchors_) af.push_back(timeToFrame(t));
      for (double f : af) {
        const long long c = std::llround(f);
        for (long long k = c - kAnchorWin; k <= c + kAnchorWin; ++k)
          if (k >= 0 && k < (long long)T) bonus[std::size_t(k)] = kAnchorBonus;
      }
      segLo.assign(T, -1);
      segHi.assign(T, -1);
      std::size_t i = 0;
      while (i < af.size()) {
        std::size_t j = i;
        while (j + 1 < af.size() && (af[j + 1] - af[j]) < 2.5 * effFps_ && af[j + 1] > af[j]) ++j;
        if (j - i + 1 >= 4) {
          // tempo locale = mediana dei (fino a) 3 intervalli di tap attorno al tratto k -> k+1
          for (std::size_t k = i; k < j; ++k) {
            std::vector<double> gaps;
            for (std::size_t q = (k > i ? k - 1 : k); q <= std::min(k + 1, j - 1); ++q) gaps.push_back(af[q + 1] - af[q]);
            std::nth_element(gaps.begin(), gaps.begin() + gaps.size() / 2, gaps.end());
            const double g = gaps[gaps.size() / 2];
            const int lo = int(std::floor(g * 0.85)) - tauMin, hi = int(std::ceil(g * 1.15)) - tauMin;
            if (hi < 0 || lo > nTau - 1) continue;
            const long long f0 = std::max<long long>(0, (long long)std::llround(af[k]));
            const long long f1 = std::min<long long>((long long)T - 1, (long long)std::llround(af[k + 1]));
            for (long long t = f0; t <= f1; ++t) { segLo[std::size_t(t)] = std::max(0, lo); segHi[std::size_t(t)] = std::min(nTau - 1, hi); }
          }
        }
        i = j + 1;
      }
    }

    std::vector<std::size_t> off(nTau + 1, 0);
    std::vector<int> half(nTau);
    for (int i = 0; i < nTau; ++i) {
      const int tau = tauMin + i;
      off[i + 1] = off[i] + std::size_t(tau);
      // Larghezza della regione beat: tau/lambda, ma al massimo 3 frame (+-1): i picchi della
      // nostra attivazione sono larghi 2-3 frame, una regione piu' larga premierebbe i tempi lenti
      // al contrario (vedi README di tuning nel report).
      half[i] = std::min(kMaxHalfRegion, std::max(0, int(std::floor(double(tau) / (2.0 * opt_.observationLambda)))));
    }
    const std::size_t S = off[nTau];

    // Transizioni tra tempi: per ogni sorgente i, peso(j) ~ exp(-lambda |tau_j/tau_i - 1|),
    // normalizzato sui target e potato sotto 1e-6 del massimo. Salvate per target (CSR).
    std::vector<std::vector<std::pair<int, float>>> byTarget(nTau);
    for (int i = 0; i < nTau; ++i) {
      std::vector<double> w(nTau);
      double sum = 0;
      for (int j = 0; j < nTau; ++j) {
        w[j] = std::exp(-opt_.tempoChangeLambda * std::fabs(double(tauMin + j) / double(tauMin + i) - 1.0));
        if (w[j] < 1e-6) w[j] = 0;
        sum += w[j];
      }
      for (int j = 0; j < nTau; ++j)
        if (w[j] > 0) byTarget[j].push_back({i, float(std::log(w[j] / sum))});
    }
    std::vector<float> prior(nTau, 0.f);
    if (opt_.tempoPriorSigma > 0)
      for (int j = 0; j < nTau; ++j) {
        const double z = std::log2(60.0 * effFps_ / double(tauMin + j) / opt_.tempoPriorBpm) / opt_.tempoPriorSigma;
        prior[j] = float(-0.5 * z * z);
      }
    for (int j = 0; j < nTau; ++j)
      for (auto& pr : byTarget[j]) pr.second += prior[j];
    std::vector<int> tOff(nTau + 1, 0), tSrc;
    std::vector<float> tLp;
    for (int j = 0; j < nTau; ++j) {
      tOff[j + 1] = tOff[j] + int(byTarget[j].size());
      for (auto& pr : byTarget[j]) { tSrc.push_back(pr.first); tLp.push_back(pr.second); }
    }

    std::vector<float> cur(S), nxt(S);
    std::vector<std::int16_t> bp(T * std::size_t(nTau), 0);
    std::vector<float> lastScore(nTau);
    const float aMin = 1e-3f, aMax = 1.f - 1e-3f;
    auto obs = [&](float v, float& lb, float& ln) {
      v = std::min(aMax, std::max(aMin, v));
      lb = std::log(v);
      ln = std::log((1.f - v) / float(opt_.observationLambda - 1.0));
    };
    {
      float lb, ln;
      obs(a[0], lb, ln);
      for (int i = 0; i < nTau; ++i) {
        const int tau = tauMin + i, h = half[i];
        for (int p = 0; p < tau; ++p) cur[off[i] + p] = ((p <= h || p >= tau - h) ? lb : ln) + prior[i];
      }
    }
    for (std::size_t t = 1; t < T; ++t) {
      float lb, ln;
      obs(a[t], lb, ln);
      const float d = lb - ln;
      for (int i = 0; i < nTau; ++i) {
        const int tau = tauMin + i, h = half[i];
        const float* src = cur.data() + off[i];
        float* dst = nxt.data() + off[i];
        for (int p = 1; p < tau; ++p) dst[p] = src[p - 1] + ln;
        for (int p = 1; p <= h; ++p) dst[p] += d;
        for (int p = std::max(h + 1, tau - h); p < tau; ++p) dst[p] += d;
        if (!segLo.empty() && segLo[t] >= 0 && (i < segLo[t] || i > segHi[t]))
          for (int p = 1; p < tau; ++p) dst[p] -= kTauOutPenalty;
        lastScore[i] = src[tau - 1];
      }
      std::int16_t* bpt = bp.data() + t * std::size_t(nTau);
      for (int j = 0; j < nTau; ++j) {
        float best = -std::numeric_limits<float>::infinity();
        int arg = j;
        for (int q = tOff[j]; q < tOff[j + 1]; ++q) {
          const float s = lastScore[tSrc[q]] + tLp[q];
          if (s > best) { best = s; arg = tSrc[q]; }
        }
        nxt[off[j]] = best + lb;
        if (!segLo.empty() && segLo[t] >= 0 && (j < segLo[t] || j > segHi[t])) nxt[off[j]] -= kTauOutPenalty;
        if (!bonus.empty() && bonus[t] > 0.f) nxt[off[j]] += bonus[t];
        bpt[j] = std::int16_t(arg);
      }
      if ((t & 31) == 0) {  // rinormalizzazione per non perdere precisione in float
        float mx = nxt[0];
        for (std::size_t s = 1; s < S; ++s) mx = std::max(mx, nxt[s]);
        for (std::size_t s = 0; s < S; ++s) nxt[s] -= mx;
      }
      cur.swap(nxt);
    }

    // Backtracking.
    std::size_t bestS = 0;
    for (std::size_t s = 1; s < S; ++s) if (cur[s] > cur[bestS]) bestS = s;
    int j = int(std::upper_bound(off.begin(), off.end(), bestS) - off.begin()) - 1;
    int p = int(bestS - off[j]);
    for (std::size_t t = T; t-- > 0;) {
      if (p == 0) bf.push_back(t);
      if (t == 0) break;
      if (p > 0) {
        --p;
      } else {
        j = bp[t * std::size_t(nTau) + j];
        p = tauMin + j - 1;
      }
    }
    std::reverse(bf.begin(), bf.end());
    return bf;
  }

  void decode(const std::vector<float>& a, BeatTrackerResult& res) const {
    const std::size_t T = a.size();
    const int tauMin = tauMinF(), tauMax = tauMaxF();
    const bool anchored = !anchors_.empty();
    std::vector<std::size_t> bf = viterbi(a, true);
    if (bf.empty()) return;

    // Controllo d'ottava: se il tempo decodificato e' > 140 BPM e una delle due sotto-sequenze
    // "un beat su due" ha attivazione media sui beat >= 0.8x quella della sequenza completa,
    // il tempo e' quasi certamente una suddivisione: si preferisce la meta' (fase migliore).
    // Non si raddoppia mai automaticamente.
    if (!anchored && bf.size() >= 16) {
      std::vector<double> ib;
      for (std::size_t i = 1; i < bf.size(); ++i) ib.push_back(double(bf[i] - bf[i - 1]));
      std::nth_element(ib.begin(), ib.begin() + ib.size() / 2, ib.end());
      if (60.0 * effFps_ / ib[ib.size() / 2] > 140.0) {
        double full = 0, ph[2] = {0, 0};
        for (std::size_t i = 0; i < bf.size(); ++i) { full += a[bf[i]]; ph[i & 1] += a[bf[i]]; }
        full /= double(bf.size());
        const int best = ph[1] > ph[0] ? 1 : 0;
        const double mh = ph[best] / double((bf.size() + (best == 0 ? 1 : 0)) / 2);
        if (mh >= 0.8 * full) {
          std::vector<std::size_t> h2;
          for (std::size_t i = std::size_t(best); i < bf.size(); i += 2) h2.push_back(bf[i]);
          bf.swap(h2);
        }
      }
    }

    // Raffinamento sub-frame.
    const double shift = kOnsetShiftWin * double(win_) / sr_;
    const long long R = 3, W = std::max<long long>(1, std::llround(0.25 * effFps_));
    std::vector<float> tmp;
    std::vector<double> af;
    for (double t : anchors_) af.push_back(timeToFrame(t));
    for (std::size_t f : bf) {
      double pos = double(f);
      bool pinned = false;  // beat sull'ancoraggio: nessun raffinamento, il tap vince
      for (double fa : af) if (std::fabs(fa - double(f)) <= double(kAnchorWin) + 0.5) { pinned = true; break; }
      if (pinned) { res.beats.push_back(pos * double(hop_) / sr_ + shift); continue; }
      const long long lo = std::max<long long>(0, (long long)f - R), hi = std::min<long long>((long long)T - 1, (long long)f + R);
      long long pk = lo;
      for (long long k = lo; k <= hi; ++k) if (a[k] > a[pk]) pk = k;
      tmp.assign(a.begin() + std::max<long long>(0, (long long)f - W), a.begin() + std::min<long long>((long long)T, (long long)f + W + 1));
      std::nth_element(tmp.begin(), tmp.begin() + tmp.size() / 2, tmp.end());
      const float med = tmp[tmp.size() / 2];
      if (a[pk] > 1.5f * std::max(med, 1e-3f) && pk > 0 && pk + 1 < (long long)T) {
        const float y0 = a[pk - 1], y1 = a[pk], y2 = a[pk + 1];
        const float den = y0 - 2 * y1 + y2;
        float dlt = den < -1e-9f ? 0.5f * (y0 - y2) / den : 0.f;
        dlt = std::max(-0.5f, std::min(0.5f, dlt));
        pos = double(pk) + dlt;
      }
      res.beats.push_back(pos * double(hop_) / sr_ + shift);
    }
    if (anchored) {  // il tap dell'utente (gia' compensato per la latenza) vince sul beat vicino
      const double tolS = (double(kAnchorWin) + 0.5) * double(hop_) / sr_;
      for (double ta : anchors_) {
        long long bi = -1;
        double bd = tolS;
        for (std::size_t i = 0; i < res.beats.size(); ++i) {
          const double d = std::fabs(res.beats[i] - ta);
          if (d <= bd) { bd = d; bi = (long long)i; }
        }
        if (bi >= 0) res.beats[std::size_t(bi)] = ta;
      }
    }
    std::sort(res.beats.begin(), res.beats.end());
    res.beats.erase(std::unique(res.beats.begin(), res.beats.end()), res.beats.end());

    if (res.beats.size() >= 2) {
      std::vector<double> ibi;
      for (std::size_t i = 1; i < res.beats.size(); ++i) ibi.push_back(res.beats[i] - res.beats[i - 1]);
      std::nth_element(ibi.begin(), ibi.begin() + ibi.size() / 2, ibi.end());
      res.medianBpm = 60.0 / ibi[ibi.size() / 2];
    }
    double sb = 0, sa = 0;
    for (std::size_t f : bf) sb += a[f];
    for (float v : a) sa += v;
    const double mb = bf.empty() ? 0 : sb / double(bf.size()), ma = sa / double(T);
    const double ratio = ma > 1e-9 ? mb / ma : 0;
    // Il solo rapporto beat/media non basta: su rumore l'HMM sceglie comunque i picchi casuali.
    // Lo si pesa con la periodicita' locale dell'attivazione (vedi periodicity()).
    const double cRatio = std::max(0.0, std::min(1.0, (ratio - 1.0) / 3.0));
    const double cPer = std::max(0.0, std::min(1.0, (periodicity(a, tauMin, tauMax) - 0.12) / 0.28));
    res.confidence = float(cRatio * cPer);
    res.ratioScore = float(ratio);
    res.periodScore = float(periodicity(a, tauMin, tauMax));
    res.ibiCv = float(ibiCv(res.beats));
    // Gate duro solo per "nessun ritmo": pochi beat, oppure confidenza bassa E segnale senza
    // eventi (rumore stazionario: livello quasi piatto) o beat irregolari. Un brano legato/lento con
    // note vere (levelDepth >= 0.45) e beat regolari (ibiCv < 0.25) resta valido ma incerto.
    const bool plausible = res.levelDepth >= kMinLevelDepth && res.ibiCv < kMaxIbiCv;
    res.valid = res.beats.size() >= 8 && (res.confidence >= kValidConfidence || plausible);
    res.uncertain = res.valid && res.confidence < kUncertainConfidence;
    // Con almeno 4 tap dell'utente il risultato e' guidato da lui: non si segnala come incerto.
    if (anchored && anchors_.size() >= 4 && res.beats.size() >= 8) { res.valid = true; res.uncertain = false; }
  }
};

}  // namespace repitch
