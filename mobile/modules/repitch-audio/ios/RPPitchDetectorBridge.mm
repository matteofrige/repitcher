#import "RPPitchDetectorBridge.h"

#include <algorithm>
#include <cmath>
#include <memory>
#include <mutex>
#include <string.h>
#include <vector>

#include "tuner/PitchDetector.hpp"

static const int kHop = 1024;       // new samples between two detections
static const int kWavePoints = 128;
static const int kWaveSpan = 2048;  // samples shown on the scope (each point averages 16)
static const float kWaveFloor = 0.05f;  // never amplify noise beyond 20x

@implementation RPPitchDetectorBridge {
  std::mutex _lock;
  std::unique_ptr<repitch::PitchDetector> _detector;
  std::vector<float> _hist;  // newest samples at the end
  int _filled;
  int _sinceDetect;
  NSInteger _seq;
  repitch::PitchResult _result;
  float _wave[kWavePoints];
}

- (instancetype)init {
  if ((self = [super init])) [self prepareWithSampleRate:48000.0];
  return self;
}

- (void)prepareWithSampleRate:(double)sampleRate {
  std::lock_guard<std::mutex> g(_lock);
  _detector = std::make_unique<repitch::PitchDetector>(sampleRate);
  const int cap = std::max(_detector->windowSize(), kWaveSpan) + kHop * 4;
  _hist.assign((size_t)cap, 0.f);
  _filled = 0;
  _sinceDetect = 0;
  _result = repitch::PitchResult();
  memset(_wave, 0, sizeof(_wave));
  _seq++;
}

- (void)reset {
  std::lock_guard<std::mutex> g(_lock);
  _filled = 0;
  _sinceDetect = 0;
  _result = repitch::PitchResult();
  memset(_wave, 0, sizeof(_wave));
  _seq++;
}

- (void)processBuffer:(AVAudioPCMBuffer *)buffer {
  const float *const *channels = buffer.floatChannelData;
  const int n = (int)buffer.frameLength;
  if (channels == nullptr || channels[0] == nullptr || n <= 0) return;
  const float *src = channels[0];

  std::lock_guard<std::mutex> g(_lock);
  const int cap = (int)_hist.size();
  if (n >= cap) {
    memcpy(_hist.data(), src + (n - cap), (size_t)cap * sizeof(float));
  } else {
    memmove(_hist.data(), _hist.data() + n, (size_t)(cap - n) * sizeof(float));
    memcpy(_hist.data() + (cap - n), src, (size_t)n * sizeof(float));
  }
  _filled = std::min(cap, _filled + n);
  _sinceDetect += n;

  const int window = _detector->windowSize();
  if (_filled < window || _sinceDetect < kHop) return;
  _sinceDetect = 0;
  _result = _detector->detect(_hist.data() + (cap - window), window);

  // Scope: last kWaveSpan samples, decimated by box-averaging (cheap anti-alias), peak-normalised.
  const int step = kWaveSpan / kWavePoints;
  const float *w = _hist.data() + (cap - kWaveSpan);
  float peak = 0.f;
  for (int i = 0; i < kWavePoints; i++) {
    float acc = 0.f;
    for (int k = 0; k < step; k++) acc += w[i * step + k];
    _wave[i] = acc / (float)step;
    peak = std::max(peak, std::fabs(_wave[i]));
  }
  const float scale = 1.f / std::max(peak, kWaveFloor);
  for (int i = 0; i < kWavePoints; i++) _wave[i] = std::max(-1.f, std::min(1.f, _wave[i] * scale));
  _seq++;
}

- (NSDictionary<NSString *, id> *)latestReading {
  std::lock_guard<std::mutex> g(_lock);
  NSMutableArray<NSNumber *> *wave = [NSMutableArray arrayWithCapacity:kWavePoints];
  for (int i = 0; i < kWavePoints; i++) [wave addObject:@(_wave[i])];
  return @{
    @"seq": @(_seq),
    @"frequency": @(_result.frequency),
    @"clarity": @(_result.clarity),
    @"rms": @(_result.rms),
    @"wave": wave,
  };
}

@end
